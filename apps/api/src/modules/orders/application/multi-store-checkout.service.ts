import { randomUUID } from "node:crypto";

import {
  checkoutOptionsV2Contract,
  checkoutPreparationV2Contract,
  createPurchaseGroupInputContract,
  devPurchaseGroupPaymentInputContract,
  devPurchaseGroupPaymentResultContract,
  purchaseGroupListContract,
  prepareCheckoutInputV2Contract,
  purchaseGroupContract,
  type CheckoutPreparationV2,
  type PrepareCheckoutInputV2,
} from "@sevo/contracts/orders/v2";
import {
  checkoutPreparationContract,
  directSettlementDisclosure,
  orderCreatedV1Contract,
} from "@sevo/contracts/orders/v1";
import {
  identityIdContract,
  orderIdContract,
  paymentAttemptIdContract,
} from "@sevo/contracts/platform/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type JSONValue, type Sql } from "postgres";

import { eventCorrelationId } from "../../../event-correlation-id";
import {
  type InventoryAuthoring,
  type InventoryTransactionContext,
} from "../../inventory/public";
import type {
  OpaqueProductTransactionContext,
  ProductAuthoritativeRead,
} from "../../product/public";
import type {
  OpaqueStoreTransactionContext,
  StoreAuthoritativeRead,
} from "../../store/public";
import { assertAuthoritativeReview, readAddress } from "./checkout-authoritative";
import {
  CheckoutAddressInvalidError,
  CheckoutChangedError,
  CheckoutIdempotencyConflictError,
  CheckoutNotReadyError,
  CheckoutRevisionExpiredError,
  CheckoutShippingUnavailableError,
  type CartRepository,
  type OrderPaymentWorkflow,
  type SavedAddressRepository,
  createOrderPaymentTransactionContext,
} from "../public";
import type { CartService } from "./cart.service";

const REVIEW_LIFETIME_MS = 10 * 60_000;
const RESERVATION_LIFETIME_MS = 15 * 60_000;

export class MultiStoreCheckoutService {
  readonly #sql: Sql;

  constructor(
    databaseUrl: string,
    private readonly carts: CartRepository,
    private readonly cartService: CartService,
    private readonly addresses: SavedAddressRepository,
    private readonly products: ProductAuthoritativeRead,
    private readonly inventory: InventoryAuthoring,
    private readonly stores: StoreAuthoritativeRead,
    private readonly createProductTransactionContext: (
      transaction: Sql,
    ) => OpaqueProductTransactionContext,
    private readonly createStoreTransactionContext: (
      transaction: Sql,
    ) => OpaqueStoreTransactionContext,
    private readonly orderWorkflow: OrderPaymentWorkflow,
    private readonly developmentPayment: boolean,
  ) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async options(identity: string) {
    const identityId = identityIdContract.parse(identity);
    const cart = await this.carts.readBuyer(identityId);
    if (!cart?.items.length) throw new CheckoutNotReadyError();
    const view = (await this.cartService.readV2(identityId, undefined)).cart;
    if (
      !view ||
      view.reviewRequired ||
      view.stores.some((section) =>
        section.items.some((item) => item.availability !== "AVAILABLE"),
      )
    ) {
      throw new CheckoutNotReadyError();
    }
    const storeIds = [...new Set(cart.items.map((item) => item.storeId))];
    const resolved = await Promise.all(
      storeIds.map((storeId) => this.stores.readStore(storeId)),
    );
    if (resolved.some((store) => !store || store.publicationStatus !== "PUBLISHED")) {
      throw new CheckoutNotReadyError();
    }
    return checkoutOptionsV2Contract.parse({
      cart: { cartId: cart.cartId, revision: cart.revision },
      stores: storeIds.map((storeId, index) => ({
        storeId,
        name: resolved[index]!.displayIdentity.name,
        shippingMethods: resolved[index]!.shippingMethods.filter(
          (method) => method.enabled,
        ).map((method) => ({
          id: method.id,
          revision: method.revision,
          code: method.code,
          label: method.label,
          fee: method.fixedFee,
          estimatedDeliveryText: method.estimatedDeliveryText,
          requiresDeliveryAddress: method.requiresDeliveryAddress,
        })),
      })),
      addresses: await this.addresses.list(identityId),
    });
  }

  async prepare(identity: string, rawInput: PrepareCheckoutInputV2) {
    const identityId = identityIdContract.parse(identity);
    const input = prepareCheckoutInputV2Contract.parse(rawInput);
    const cart = await this.carts.readBuyer(identityId);
    if (!cart || !cart.items.length || cart.cartId !== input.cartId)
      throw new CheckoutNotReadyError();
    if (cart.revision !== input.cartRevision) {
      throw new CheckoutChangedError([
        { kind: "QUANTITY_CHANGED", variantId: cart.items[0]!.variantId },
      ]);
    }
    const view = (await this.cartService.readV2(identityId, undefined)).cart;
    if (!view || view.reviewRequired) throw new CheckoutNotReadyError();
    const storeIds = [...new Set(cart.items.map((item) => item.storeId))];
    if (
      input.shipping.length !== storeIds.length ||
      storeIds.some(
        (storeId) => !input.shipping.some((choice) => choice.storeId === storeId),
      )
    ) {
      throw new CheckoutShippingUnavailableError();
    }
    const [resolvedStores, addressList] = await Promise.all([
      Promise.all(storeIds.map((storeId) => this.stores.readStore(storeId))),
      this.addresses.list(identityId),
    ]);
    const childPreparations = await Promise.all(
      storeIds.map(async (storeId, index) => {
        const store = resolvedStores[index];
        if (
          !store ||
          store.publicationStatus !== "PUBLISHED" ||
          !store.returnPolicy ||
          store.settlement?.mode !== "DIRECT" ||
          store.settlement.status !== "TEST_VERIFIED"
        ) {
          throw new CheckoutNotReadyError();
        }
        const selected = input.shipping.find((choice) => choice.storeId === storeId)!;
        const shipping = store.shippingMethods.find(
          (method) => method.id === selected.shippingMethodId,
        );
        if (!shipping?.enabled || shipping.revision !== selected.shippingMethodRevision)
          throw new CheckoutShippingUnavailableError();
        const address = addressList.find(
          (candidate) => candidate.addressId === input.savedAddressId,
        );
        if (
          shipping.requiresDeliveryAddress &&
          (!address ||
            address.revision !== input.addressRevision ||
            (shipping.requiresPostalCode && !address.postalCode))
        ) {
          throw new CheckoutAddressInvalidError();
        }
        const cartItems = cart.items.filter((item) => item.storeId === storeId);
        const products = await Promise.all(
          cartItems.map((item) =>
            this.products.readAuthoritativeVariant(item.variantId),
          ),
        );
        const stock = new Map(
          (await this.inventory.readMany(cartItems.map((item) => item.variantId))).map(
            (entry) => [entry.variantId, entry.available],
          ),
        );
        const items = cartItems.map((item, itemIndex) => {
          const product = products[itemIndex];
          if (
            !product?.sellable ||
            product.storeId !== storeId ||
            (stock.get(item.variantId) ?? 0) < item.quantity
          ) {
            throw new CheckoutChangedError([
              { kind: "VARIANT_UNAVAILABLE", variantId: item.variantId },
            ]);
          }
          const lineTotal = product.unitPrice.amount * item.quantity;
          assertAmount(lineTotal);
          return {
            productId: product.productId,
            variantId: item.variantId,
            name: product.name,
            quantity: item.quantity,
            publicationVersion: product.publicationVersion,
            unitPrice: product.unitPrice,
            lineTotal: { amount: lineTotal, currency: "IRR" as const },
          };
        });
        const subtotal = items.reduce(
          (total, item) => total + item.lineTotal.amount,
          0,
        );
        const total = subtotal + shipping.fixedFee.amount;
        assertAmount(total);
        return checkoutPreparationContract.parse({
          checkoutRevision: randomUUID(),
          expiresAt: new Date(Date.now() + REVIEW_LIFETIME_MS).toISOString(),
          cart: { cartId: cart.cartId, revision: cart.revision },
          store: { storeId, name: store.displayIdentity.name },
          items,
          ...(shipping.requiresDeliveryAddress && address ? { address } : {}),
          shippingMethod: {
            id: shipping.id,
            revision: shipping.revision,
            code: shipping.code,
            label: shipping.label,
            fee: shipping.fixedFee,
            estimatedDeliveryText: shipping.estimatedDeliveryText,
            requiresDeliveryAddress: shipping.requiresDeliveryAddress,
          },
          returnPolicy: store.returnPolicy,
          subtotal: { amount: subtotal, currency: "IRR" },
          total: { amount: total, currency: "IRR" },
          settlement: { mode: "DIRECT", disclosure: directSettlementDisclosure },
        });
      }),
    );
    const total = childPreparations.reduce(
      (amount, child) => amount + child.total.amount,
      0,
    );
    assertAmount(total);
    const preparation = checkoutPreparationV2Contract.parse({
      checkoutRevision: randomUUID(),
      expiresAt: new Date(Date.now() + REVIEW_LIFETIME_MS).toISOString(),
      cart: { cartId: cart.cartId, revision: cart.revision },
      stores: childPreparations,
      total: { amount: total, currency: "IRR" },
    });
    await this.#sql`
      insert into order_purchase_group_preparations
        (checkout_revision, identity_id, cart_id, cart_revision, snapshot, expires_at)
      values (${preparation.checkoutRevision}, ${identityId}, ${cart.cartId}, ${cart.revision},
        ${this.#sql.json(asJson(preparation))}, ${new Date(preparation.expiresAt)})
    `;
    return preparation;
  }

  async createGroup(
    identity: string,
    rawInput: unknown,
    idempotencyKey: string,
    correlationId: string,
  ) {
    const identityId = identityIdContract.parse(identity);
    const input = createPurchaseGroupInputContract.parse(rawInput);
    const groupId = await this.#sql.begin(async (sql) => {
      const existingByKey = await sql<Array<{ id: string; checkoutRevision: string }>>`
        select id, checkout_revision as "checkoutRevision" from order_purchase_groups
        where identity_id = ${identityId} and idempotency_key = ${idempotencyKey}
        for update
      `;
      if (existingByKey[0]) {
        if (existingByKey[0].checkoutRevision !== input.checkoutRevision)
          throw new CheckoutIdempotencyConflictError();
        return existingByKey[0].id;
      }
      const rows = await sql<
        Array<{ snapshot: JSONValue; expiresAt: Date; consumedGroupId: string | null }>
      >`
        select snapshot, expires_at as "expiresAt", consumed_group_id as "consumedGroupId"
        from order_purchase_group_preparations
        where checkout_revision = ${input.checkoutRevision} and identity_id = ${identityId}
        for update
      `;
      const row = rows[0];
      if (!row || row.expiresAt.getTime() <= Date.now())
        throw new CheckoutRevisionExpiredError();
      if (row.consumedGroupId) return row.consumedGroupId;
      const review = checkoutPreparationV2Contract.parse(row.snapshot);
      const carts = await sql<Array<{ revision: number; status: string }>>`
        select revision, status from order_carts
        where id = ${review.cart.cartId} and identity_id = ${identityId}
        for update
      `;
      if (
        carts[0]?.status !== "ACTIVE" ||
        carts[0].revision !== review.cart.revision ||
        input.cartRevision !== review.cart.revision
      ) {
        throw new CheckoutChangedError(
          review.stores.flatMap((store) =>
            store.items.map((item) => ({
              kind: "QUANTITY_CHANGED" as const,
              variantId: item.variantId,
            })),
          ),
        );
      }
      const id = randomUUID();
      const reservationExpiresAt = new Date(Date.now() + RESERVATION_LIFETIME_MS);
      for (const child of review.stores) {
        if (
          child.address &&
          !(await readAddress(
            sql,
            identityId,
            child.address.addressId,
            child.address.revision,
          ))
        ) {
          throw new CheckoutAddressInvalidError();
        }
        await assertAuthoritativeReview(
          sql,
          child,
          this.products,
          this.stores,
          this.createProductTransactionContext,
          this.createStoreTransactionContext,
        );
      }
      await sql`
        insert into order_purchase_groups
          (id, identity_id, cart_id, checkout_revision, idempotency_key, status,
           total_amount, currency, review_snapshot, reservation_expires_at)
        values (${id}, ${identityId}, ${review.cart.cartId}, ${input.checkoutRevision},
          ${idempotencyKey}, 'PENDING_PAYMENT', ${review.total.amount}, 'IRR',
          ${sql.json(asJson(review))}, ${reservationExpiresAt})
      `;
      for (const child of review.stores) {
        const orderId = randomUUID();
        const reservationId = randomUUID();
        await sql`
          insert into order_checkout_preparations
            (checkout_revision, identity_id, cart_id, cart_revision, address_id,
             address_revision, shipping_method_id, shipping_revision, policy_revision,
             snapshot, expires_at)
          values (${child.checkoutRevision}, ${identityId}, ${review.cart.cartId},
            ${review.cart.revision}, ${child.address?.addressId ?? null},
            ${child.address?.revision ?? null}, ${child.shippingMethod.id},
            ${child.shippingMethod.revision}, ${child.returnPolicy.revision},
            ${sql.json(asJson(child))}, ${new Date(child.expiresAt)})
        `;
        await sql`
          insert into order_orders
            (id, identity_id, store_id, purchase_group_id, checkout_revision,
             reservation_id, status, total_amount, currency, reservation_expires_at, review_snapshot)
          values (${orderId}, ${identityId}, ${child.store.storeId}, ${id}, ${child.checkoutRevision},
            ${reservationId}, 'PENDING_PAYMENT', ${child.total.amount}, 'IRR',
            ${reservationExpiresAt}, ${sql.json(asJson(child))})
        `;
        await sql`
          update order_checkout_preparations set consumed_order_id = ${orderId}
          where checkout_revision = ${child.checkoutRevision}
        `;
        await this.inventory.reserveForOrder(
          sql as unknown as InventoryTransactionContext,
          {
            reservationId,
            orderId,
            storeId: child.store.storeId,
            expiresAt: reservationExpiresAt,
            items: child.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
            })),
          },
        );
        for (const item of child.items) {
          await sql`
            insert into order_items
              (order_id, variant_id, product_id, name, quantity, unit_price_amount, publication_version)
            values (${orderId}, ${item.variantId}, ${item.productId}, ${item.name},
              ${item.quantity}, ${item.unitPrice.amount}, ${item.publicationVersion})
          `;
        }
        await sql`
          insert into order_shipping_snapshots
            (order_id, shipping_method_id, shipping_method_revision, code, label, fee_amount, estimated_delivery_text)
          values (${orderId}, ${child.shippingMethod.id}, ${child.shippingMethod.revision},
            ${child.shippingMethod.code}, ${child.shippingMethod.label},
            ${child.shippingMethod.fee.amount}, ${child.shippingMethod.estimatedDeliveryText})
        `;
        await sql`
          insert into order_policy_snapshots (order_id, revision, text)
          values (${orderId}, ${child.returnPolicy.revision}, ${child.returnPolicy.text})
        `;
        if (child.address) {
          await sql`
            insert into order_delivery_snapshots
              (order_id, address_id, address_revision, recipient_name, recipient_mobile,
               province_text, city_text, address_line, postal_code)
            values (${orderId}, ${child.address.addressId}, ${child.address.revision},
              ${child.address.recipientName}, ${child.address.recipientMobile},
              ${child.address.provinceText}, ${child.address.cityText},
              ${child.address.addressLine}, ${child.address.postalCode ?? null})
          `;
        }
        await enqueueOutboxEvent(
          sql,
          orderCreatedV1Contract.parse({
            eventId: randomUUID(),
            version: 1,
            eventType: "OrderCreated.v1",
            aggregateId: orderId,
            aggregateVersion: 1,
            occurredAt: new Date().toISOString(),
            correlationId: eventCorrelationId(correlationId),
            causationId: id,
            actor: { type: "IDENTITY", id: identityId },
            payload: { status: "PENDING_PAYMENT", total: child.total },
          }),
        );
      }
      await sql`update order_purchase_group_preparations set consumed_group_id = ${id} where checkout_revision = ${input.checkoutRevision}`;
      await sql`update order_carts set status = 'CONVERTED', updated_at = now() where id = ${review.cart.cartId}`;
      return id;
    });
    return this.readGroup(identityId, groupId);
  }

  async payGroupDev(
    identity: string,
    rawGroupId: string,
    rawInput: unknown,
    idempotencyKey: string,
    correlationId: string,
  ) {
    if (!this.developmentPayment) throw new CheckoutNotReadyError();
    const identityId = identityIdContract.parse(identity);
    const input = devPurchaseGroupPaymentInputContract.parse(rawInput);
    const groupId = rawGroupId;
    const attempt = await this.#sql.begin(async (sql) => {
      const groups = await sql<
        Array<{ status: string; totalAmount: number; reservationExpiresAt: Date }>
      >`
        select status, total_amount::float8 as "totalAmount",
          reservation_expires_at as "reservationExpiresAt"
        from order_purchase_groups
        where id = ${groupId}::uuid and identity_id = ${identityId}
        for update
      `;
      const group = groups[0];
      if (!group) throw new CheckoutNotReadyError();
      const previous = await sql<
        Array<{ id: string; groupId: string; status: string }>
      >`
        select id, group_id as "groupId", status from order_purchase_group_dev_attempts
        where identity_id = ${identityId} and idempotency_key = ${idempotencyKey}
        for update
      `;
      if (previous[0]) {
        if (previous[0].groupId !== groupId)
          throw new CheckoutIdempotencyConflictError();
        return previous[0];
      }
      if (
        group.status === "PAID" ||
        group.status === "PAYMENT_REVIEW" ||
        group.reservationExpiresAt <= new Date()
      ) {
        throw new CheckoutNotReadyError();
      }
      const active = await sql<Array<{ id: string; groupId: string; status: string }>>`
        select id, group_id as "groupId", status from order_purchase_group_dev_attempts
        where group_id = ${groupId}::uuid and status in ('CREATED', 'CONFIRMED', 'REVIEW_REQUIRED')
        for update
      `;
      if (active[0]) return active[0];
      const children = await sql<
        Array<{ orderId: string; reservationId: string; status: string }>
      >`
        select id as "orderId", reservation_id as "reservationId", status
        from order_orders where purchase_group_id = ${groupId}::uuid
        order by store_id for update
      `;
      if (
        !children.length ||
        children.some((child) => child.status !== "PENDING_PAYMENT")
      ) {
        throw new CheckoutNotReadyError();
      }
      const id = randomUUID();
      await sql`
        insert into order_purchase_group_dev_attempts
          (id, group_id, identity_id, idempotency_key, status, amount, currency, provider)
        values (${id}, ${groupId}, ${identityId}, ${idempotencyKey}, 'CREATED',
          ${group.totalAmount}, 'IRR', 'DEV')
      `;
      for (const child of children) {
        await this.inventory.holdReservationForPayment(
          sql as unknown as InventoryTransactionContext,
          {
            reservationId: child.reservationId,
            attemptId: id,
            leaseUntil: new Date(Date.now() + 2 * 60_000),
            now: new Date(),
          },
        );
      }
      return { id, groupId, status: "CREATED" };
    });
    if (
      attempt.status === "FAILED" ||
      attempt.status === "CONFIRMED" ||
      attempt.status === "REVIEW_REQUIRED"
    ) {
      return this.#paymentResult(identityId, groupId, attempt.id);
    }
    if (input.scenario === "failure") {
      await this.#resolveDevFailure(groupId, attempt.id, correlationId);
      return this.#paymentResult(identityId, groupId, attempt.id);
    }
    if (input.scenario === "pending") {
      await this.#moveDevPaymentToReview(groupId, attempt.id, correlationId);
      return this.#paymentResult(identityId, groupId, attempt.id);
    }
    try {
      await this.#sql.begin(async (sql) => {
        const attempts = await sql<Array<{ status: string; amount: number }>>`
          select status, amount::float8 as amount from order_purchase_group_dev_attempts
          where id = ${attempt.id}::uuid and group_id = ${groupId}::uuid
          for update
        `;
        if (attempts[0]?.status !== "CREATED") throw new CheckoutNotReadyError();
        const groupRows = await sql<Array<{ status: string; totalAmount: number }>>`
          select status, total_amount::float8 as "totalAmount" from order_purchase_groups
          where id = ${groupId}::uuid for update
        `;
        if (
          groupRows[0]?.status !== "PENDING_PAYMENT" ||
          groupRows[0].totalAmount !== attempts[0].amount
        ) {
          throw new CheckoutNotReadyError();
        }
        const children = await sql<
          Array<{ orderId: string; reservationId: string; status: string }>
        >`
          select id as "orderId", reservation_id as "reservationId", status
          from order_orders where purchase_group_id = ${groupId}::uuid
          order by store_id for update
        `;
        if (
          !children.length ||
          children.some((child) => child.status !== "PENDING_PAYMENT")
        )
          throw new CheckoutNotReadyError();
        for (const child of children) {
          const consumed = await this.inventory.consumeReservation(
            sql as unknown as InventoryTransactionContext,
            {
              reservationId: child.reservationId,
              attemptId: attempt.id,
            },
          );
          if (!consumed) throw new CheckoutNotReadyError();
        }
        const paidAt = new Date();
        for (const child of children) {
          await this.orderWorkflow.markPaid(createOrderPaymentTransactionContext(sql), {
            orderId: orderIdContract.parse(child.orderId),
            attemptId: paymentAttemptIdContract.parse(attempt.id),
            paidAt,
            correlationId,
          });
        }
        await sql`
          update order_purchase_group_dev_attempts set status = 'CONFIRMED', confirmed_at = ${paidAt},
            provider_reference = ${`DEV-GROUP-${attempt.id}`}
          where id = ${attempt.id}::uuid
        `;
        await sql`
          update order_purchase_groups set status = 'PAID', paid_at = ${paidAt}
          where id = ${groupId}::uuid and status = 'PENDING_PAYMENT'
        `;
      });
      return this.#paymentResult(identityId, groupId, attempt.id);
    } catch {
      await this.#moveDevPaymentToReview(groupId, attempt.id, correlationId);
      return this.#paymentResult(identityId, groupId, attempt.id);
    }
  }

  async #paymentResult(identityId: string, groupId: string, attemptId: string) {
    const [purchase, rows] = await Promise.all([
      this.readGroup(identityId, groupId),
      this.#sql<Array<{ status: string }>>`
        select status from order_purchase_group_dev_attempts
        where id = ${attemptId}::uuid and identity_id = ${identityId}
      `,
    ]);
    if (!purchase || !rows[0]) throw new CheckoutNotReadyError();
    return devPurchaseGroupPaymentResultContract.parse({
      paymentStatus: rows[0].status,
      purchase,
    });
  }

  async #resolveDevFailure(groupId: string, attemptId: string, correlationId: string) {
    await this.#sql.begin(async (sql) => {
      const rows = await sql<Array<{ status: string }>>`
        select status from order_purchase_group_dev_attempts where id = ${attemptId}::uuid
          and group_id = ${groupId}::uuid for update
      `;
      if (rows[0]?.status !== "CREATED") return;
      const children = await sql<Array<{ reservationId: string; orderId: string }>>`
        select reservation_id as "reservationId", id as "orderId"
        from order_orders where purchase_group_id = ${groupId}::uuid
        order by store_id for update
      `;
      for (const child of children) {
        await this.inventory.resolveFailedPayment(
          sql as unknown as InventoryTransactionContext,
          {
            reservationId: child.reservationId,
            attemptId,
            now: new Date(),
          },
        );
        await this.orderWorkflow.resolvePaymentFailure(
          createOrderPaymentTransactionContext(sql),
          {
            orderId: orderIdContract.parse(child.orderId),
            attemptId: paymentAttemptIdContract.parse(attemptId),
            occurredAt: new Date(),
            correlationId,
          },
        );
      }
      await sql`update order_purchase_group_dev_attempts set status = 'FAILED' where id = ${attemptId}::uuid`;
    });
  }

  async #moveDevPaymentToReview(
    groupId: string,
    attemptId: string,
    correlationId: string,
  ) {
    await this.#sql.begin(async (sql) => {
      const rows = await sql<Array<{ status: string }>>`
        select status from order_purchase_group_dev_attempts where id = ${attemptId}::uuid
          and group_id = ${groupId}::uuid for update
      `;
      if (rows[0]?.status !== "CREATED") return;
      const children = await sql<Array<{ reservationId: string; orderId: string }>>`
        select reservation_id as "reservationId", id as "orderId"
        from order_orders where purchase_group_id = ${groupId}::uuid
        order by store_id for update
      `;
      for (const child of children) {
        await this.inventory.holdReservationForReview(
          sql as unknown as InventoryTransactionContext,
          {
            reservationId: child.reservationId,
            attemptId,
          },
        );
        await this.orderWorkflow.markPaymentReview(
          createOrderPaymentTransactionContext(sql),
          {
            orderId: orderIdContract.parse(child.orderId),
            attemptId: paymentAttemptIdContract.parse(attemptId),
            occurredAt: new Date(),
            correlationId,
            reasonCode: "PAYMENT_DISPATCH_UNRESOLVED",
          },
        );
      }
      await sql`update order_purchase_group_dev_attempts set status = 'REVIEW_REQUIRED' where id = ${attemptId}::uuid`;
      await sql`update order_purchase_groups set status = 'PAYMENT_REVIEW' where id = ${groupId}::uuid`;
    });
  }

  async readGroup(identity: string, rawGroupId: string) {
    const identityId = identityIdContract.parse(identity);
    const rows = await this.#sql<
      Array<{
        groupId: string;
        status: string;
        totalAmount: number;
        createdAt: Date;
        reservationExpiresAt: Date;
        paidAt: Date | null;
        review: JSONValue;
      }>
    >`
      select id as "groupId", status, total_amount::float8 as "totalAmount",
        created_at as "createdAt", reservation_expires_at as "reservationExpiresAt",
        paid_at as "paidAt", review_snapshot as review
      from order_purchase_groups where id = ${rawGroupId}::uuid and identity_id = ${identityId}
    `;
    const row = rows[0];
    if (!row) return undefined;
    const review: CheckoutPreparationV2 = checkoutPreparationV2Contract.parse(
      row.review,
    );
    const [children, unresolved] = await Promise.all([
      this.#sql<Array<{ orderId: string; storeId: string; status: string }>>`
      select id as "orderId", store_id as "storeId", status
      from order_orders where purchase_group_id = ${row.groupId}
      order by created_at, id
      `,
      this.#sql<Array<{ present: boolean }>>`
        select exists (
          select 1 from order_purchase_group_dev_attempts
          where group_id = ${row.groupId} and status in ('CREATED', 'REVIEW_REQUIRED')
        ) as present
      `,
    ]);
    return purchaseGroupContract.parse({
      groupId: row.groupId,
      status:
        row.status === "PENDING_PAYMENT" && unresolved[0]?.present
          ? "PAYMENT_REVIEW"
          : row.status,
      total: { amount: row.totalAmount, currency: "IRR" },
      createdAt: row.createdAt.toISOString(),
      reservationExpiresAt: row.reservationExpiresAt.toISOString(),
      ...(row.paidAt ? { paidAt: row.paidAt.toISOString() } : {}),
      stores: review.stores.map((child) => {
        const order = children.find(
          (candidate) => candidate.storeId === child.store.storeId,
        );
        if (!order) throw new Error("Purchase group has a missing child order");
        return {
          storeId: child.store.storeId,
          name: child.store.name,
          orderId: order.orderId,
          status: order.status,
          total: child.total,
          shippingLabel: child.shippingMethod.label,
          returnPolicyText: child.returnPolicy.text,
        };
      }),
    });
  }

  async listGroups(identity: string) {
    const identityId = identityIdContract.parse(identity);
    const rows = await this.#sql<Array<{ id: string }>>`
      select id from order_purchase_groups
      where identity_id = ${identityId}
      order by created_at desc, id desc
      limit 100
    `;
    const items = await Promise.all(
      rows.map((row) => this.readGroup(identityId, row.id)),
    );
    return purchaseGroupListContract.parse({
      items: items.filter((item) => item !== undefined),
    });
  }
}

function assertAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new CheckoutNotReadyError();
}

function asJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
