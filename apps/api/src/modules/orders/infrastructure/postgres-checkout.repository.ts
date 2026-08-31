import { randomUUID } from "node:crypto";

import {
  orderConversationEligibilityInputContract,
  orderPurchaseExperienceEligibilityDecisionContract,
  orderPurchaseExperienceEligibilityInputContract,
  checkoutPreparationContract,
  orderContract,
  orderCreatedV1Contract,
  orderBecameActionableV1Contract,
  orderReportingSnapshotV1Contract,
  orderPaymentReviewRequiredV1Contract,
  orderExpiredV1Contract,
  sellerActionableOrderContract,
} from "@sevo/contracts/orders/v1";
import type { IdentityId, OrderId, StoreId } from "@sevo/contracts/platform/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type JSONValue, type Sql } from "postgres";

import { eventCorrelationId } from "../../../event-correlation-id";
import {
  InventoryReservationUnavailableError,
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
import {
  CheckoutAddressInvalidError,
  CheckoutChangedError,
  CheckoutIdempotencyConflictError,
  CheckoutIdempotencyInProgressError,
  CheckoutRevisionExpiredError,
  type OrderConversationEligibility,
  type OrderPurchaseExperienceEligibilityRead,
  type CheckoutRepository,
  type OrderPaymentTransactionContext,
  type OrderPaymentWorkflow,
} from "../public";

type PreparationRow = {
  snapshot: JSONValue;
  expiresAt: Date;
  consumedOrderId: string | null;
};

export class PostgresCheckoutRepository
  implements
    CheckoutRepository,
    OrderPaymentWorkflow,
    OrderConversationEligibility,
    OrderPurchaseExperienceEligibilityRead
{
  readonly #sql: Sql;

  constructor(
    databaseUrl: string,
    private readonly inventory: InventoryAuthoring,
    private readonly products?: ProductAuthoritativeRead,
    private readonly stores?: StoreAuthoritativeRead,
    private readonly createProductTransactionContext?: (
      transaction: Sql,
    ) => OpaqueProductTransactionContext,
    private readonly createStoreTransactionContext?: (
      transaction: Sql,
    ) => OpaqueStoreTransactionContext,
  ) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async savePreparation(command: Parameters<CheckoutRepository["savePreparation"]>[0]) {
    const preparation = command.preparation;
    await this.#sql`
      insert into order_checkout_preparations
        (checkout_revision, identity_id, cart_id, cart_revision, address_id,
         address_revision, shipping_method_id, shipping_revision, policy_revision,
         snapshot, expires_at)
      values
        (${preparation.checkoutRevision}, ${command.identityId},
         ${preparation.cart.cartId}, ${preparation.cart.revision},
         ${preparation.address?.addressId ?? null},
         ${preparation.address?.revision ?? null}, ${preparation.shippingMethod.id},
         ${preparation.shippingMethod.revision}, ${preparation.returnPolicy.revision},
         ${this.#sql.json(asJson(preparation))}, ${new Date(preparation.expiresAt)})
    `;
    return preparation;
  }

  async readPreparation(identityId: IdentityId, checkoutRevision: string) {
    const rows = await this.#sql<PreparationRow[]>`
      select snapshot, expires_at as "expiresAt",
        consumed_order_id as "consumedOrderId"
      from order_checkout_preparations
      where checkout_revision = ${checkoutRevision}::uuid
        and identity_id = ${identityId}
    `;
    return rows[0] ? checkoutPreparationContract.parse(rows[0].snapshot) : undefined;
  }

  async readPurchaseExperienceEligibility(
    input: Parameters<
      OrderPurchaseExperienceEligibilityRead["readPurchaseExperienceEligibility"]
    >[0],
  ) {
    const parsed = orderPurchaseExperienceEligibilityInputContract.safeParse(input);
    if (!parsed.success) {
      return orderPurchaseExperienceEligibilityDecisionContract.parse({
        eligible: false,
        reason: "NOT_ELIGIBLE",
      });
    }
    const [row] = await this.#sql<
      Array<{
        buyerId: string;
        orderItemId: string;
        storeId: string;
        productId: string;
      }>
    >`
      select orders.identity_id as "buyerId", items.id as "orderItemId",
        orders.store_id as "storeId", items.product_id as "productId"
      from order_items items
      join order_orders orders on orders.id = items.order_id
      where items.id = ${parsed.data.orderItemId}
        and orders.identity_id = ${parsed.data.buyerId}
        and orders.status = 'PAID'
      limit 1
    `;
    return orderPurchaseExperienceEligibilityDecisionContract.parse(
      row
        ? { eligible: true, ...row, purchaseStatus: "CONFIRMED" }
        : { eligible: false, reason: "NOT_ELIGIBLE" },
    );
  }

  async replayOrder(
    identityId: IdentityId,
    idempotencyKey: string,
    requestHash: string,
  ) {
    const rows = await this.#sql<
      Array<{
        requestHash: string;
        state: string;
        lockedUntil: Date;
        response: JSONValue | null;
      }>
    >`
      select request_hash as "requestHash", state,
        locked_until as "lockedUntil", response_json as response
      from order_create_idempotency_records
      where identity_id = ${identityId} and key = ${idempotencyKey}
    `;
    if (!rows[0]) return undefined;
    if (rows[0].requestHash !== requestHash) {
      throw new CheckoutIdempotencyConflictError();
    }
    if (rows[0].state !== "COMPLETED" || rows[0].response === null) {
      if (rows[0].lockedUntil.getTime() <= Date.now()) return undefined;
      throw new CheckoutIdempotencyInProgressError();
    }
    return orderContract.parse(rows[0].response);
  }

  async createOrder(command: Parameters<CheckoutRepository["createOrder"]>[0]) {
    try {
      return await this.#sql.begin(async (sql) => {
        const lock = await sql<Array<{ locked: boolean }>>`
          select pg_try_advisory_xact_lock(
            hashtextextended(${`create-order:${command.identityId}:${command.idempotencyKey}`}, 0)
          ) as locked
        `;
        if (!lock[0]?.locked) throw new CheckoutIdempotencyInProgressError();
        const replay = await sql<
          Array<{
            requestHash: string;
            state: string;
            lockedUntil: Date;
            response: JSONValue | null;
          }>
        >`
          select request_hash as "requestHash", state,
            locked_until as "lockedUntil", response_json as response
          from order_create_idempotency_records
          where identity_id = ${command.identityId} and key = ${command.idempotencyKey}
        `;
        if (replay[0]) {
          if (replay[0].requestHash !== command.requestHash) {
            throw new CheckoutIdempotencyConflictError();
          }
          if (replay[0].state === "COMPLETED" && replay[0].response !== null) {
            return orderContract.parse(replay[0].response);
          }
          if (replay[0].lockedUntil.getTime() > Date.now()) {
            throw new CheckoutIdempotencyInProgressError();
          }
          await sql`
            update order_create_idempotency_records
            set state = 'IN_PROGRESS', locked_until = now() + interval '30 seconds',
              response_json = null, completed_at = null
            where identity_id = ${command.identityId} and key = ${command.idempotencyKey}
          `;
        } else {
          await sql`
            insert into order_create_idempotency_records
              (identity_id, key, request_hash, state, locked_until)
            values
              (${command.identityId}, ${command.idempotencyKey}, ${command.requestHash},
               'IN_PROGRESS', now() + interval '30 seconds')
          `;
        }

        const preparations = await sql<PreparationRow[]>`
          select snapshot, expires_at as "expiresAt",
            consumed_order_id as "consumedOrderId"
          from order_checkout_preparations
          where checkout_revision = ${command.input.checkoutRevision}
            and identity_id = ${command.identityId}
          for update
        `;
        const row = preparations[0];
        if (!row || row.expiresAt.getTime() <= Date.now()) {
          throw new CheckoutRevisionExpiredError();
        }
        const review = checkoutPreparationContract.parse(row.snapshot);
        if (row.consumedOrderId) {
          const existing = await sql<
            Array<{
              orderId: string;
              reservationId: string;
              reservationExpiresAt: Date;
              createdAt: Date;
            }>
          >`
            select id as "orderId", reservation_id as "reservationId",
              reservation_expires_at as "reservationExpiresAt",
              created_at as "createdAt"
            from order_orders where id = ${row.consumedOrderId}
          `;
          const persisted = existing[0];
          if (!persisted) throw new CheckoutRevisionExpiredError();
          const result = orderContract.parse({
            ...persisted,
            status: "PENDING_PAYMENT",
            reservationExpiresAt: persisted.reservationExpiresAt.toISOString(),
            createdAt: persisted.createdAt.toISOString(),
            review,
          });
          await completeOrderIdempotency(sql, command, result);
          return result;
        }
        const carts = await sql<Array<{ revision: number }>>`
          select revision from order_carts
          where id = ${review.cart.cartId} and identity_id = ${command.identityId}
            and status = 'ACTIVE' and expires_at > now()
          for update
        `;
        if (carts[0]?.revision !== command.input.cartRevision) {
          throw new CheckoutChangedError(
            review.items.map((item) => ({
              kind: "QUANTITY_CHANGED" as const,
              variantId: item.variantId,
            })),
          );
        }
        if (
          command.input.cartRevision !== review.cart.revision ||
          command.input.shippingMethodRevision !== review.shippingMethod.revision ||
          command.input.returnPolicyRevision !== review.returnPolicy.revision ||
          command.input.addressRevision !== review.address?.revision
        ) {
          throw new CheckoutChangedError(
            review.items.map((item) => ({
              kind: "QUANTITY_CHANGED" as const,
              variantId: item.variantId,
            })),
          );
        }
        const delivery = review.address
          ? await readAddress(
              sql,
              command.identityId,
              review.address.addressId,
              command.input.addressRevision,
            )
          : undefined;
        if (review.address && !delivery) throw new CheckoutAddressInvalidError();

        await assertAuthoritativeReview(
          sql,
          review,
          this.products,
          this.stores,
          this.createProductTransactionContext,
          this.createStoreTransactionContext,
        );

        await sql`
          insert into order_orders
            (id, identity_id, store_id, checkout_revision, reservation_id, status,
             total_amount, currency, reservation_expires_at, review_snapshot)
          values
            (${command.orderId}, ${command.identityId}, ${review.store.storeId},
             ${review.checkoutRevision}, ${command.reservationId}, 'PENDING_PAYMENT',
             ${review.total.amount}, 'IRR', ${command.reservationExpiresAt},
             ${sql.json(asJson(review))})
        `;
        await this.inventory.reserveForOrder(
          sql as unknown as InventoryTransactionContext,
          {
            reservationId: command.reservationId,
            orderId: command.orderId,
            storeId: review.store.storeId,
            expiresAt: command.reservationExpiresAt,
            items: review.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
            })),
          },
        );
        for (const item of review.items) {
          await sql`
            insert into order_items
              (order_id, variant_id, product_id, name, quantity,
               unit_price_amount, publication_version)
            values
              (${command.orderId}, ${item.variantId}, ${item.productId}, ${item.name},
               ${item.quantity}, ${item.unitPrice.amount}, ${item.publicationVersion})
          `;
        }
        await sql`
          insert into order_shipping_snapshots
            (order_id, shipping_method_id, shipping_method_revision, code, label,
             fee_amount, estimated_delivery_text)
          values
            (${command.orderId}, ${review.shippingMethod.id},
             ${review.shippingMethod.revision}, ${review.shippingMethod.code},
             ${review.shippingMethod.label}, ${review.shippingMethod.fee.amount},
             ${review.shippingMethod.estimatedDeliveryText})
        `;
        await sql`
          insert into order_policy_snapshots (order_id, revision, text)
          values
            (${command.orderId}, ${review.returnPolicy.revision},
             ${review.returnPolicy.text})
        `;
        if (delivery) {
          await sql`
            insert into order_delivery_snapshots
              (order_id, address_id, address_revision, recipient_name,
               recipient_mobile, province_text, city_text, address_line, postal_code)
            values
               (${command.orderId}, ${review.address!.addressId},
               ${review.address!.revision}, ${review.address!.recipientName},
               ${review.address!.recipientMobile}, ${review.address!.provinceText},
               ${review.address!.cityText}, ${review.address!.addressLine},
               ${review.address!.postalCode ?? null})
          `;
        }
        await sql`
          update order_checkout_preparations
          set consumed_order_id = ${command.orderId}
          where checkout_revision = ${review.checkoutRevision}
        `;
        await sql`
          update order_carts set status = 'CONVERTED', updated_at = now()
          where id = ${review.cart.cartId} and status = 'ACTIVE'
        `;
        await enqueueOutboxEvent(
          sql,
          orderCreatedV1Contract.parse({
            eventId: randomUUID(),
            version: 1,
            eventType: "OrderCreated.v1",
            aggregateId: command.orderId,
            aggregateVersion: 1,
            occurredAt: new Date().toISOString(),
            correlationId: eventCorrelationId(command.correlationId),
            causationId: command.orderId,
            actor: { type: "IDENTITY", id: command.identityId },
            payload: { status: "PENDING_PAYMENT", total: review.total },
          }),
        );
        const createdAt = new Date().toISOString();
        const result = orderContract.parse({
          orderId: command.orderId,
          status: "PENDING_PAYMENT",
          reservationId: command.reservationId,
          reservationExpiresAt: command.reservationExpiresAt.toISOString(),
          createdAt,
          review,
        });
        await completeOrderIdempotency(sql, command, result);
        return result;
      });
    } catch (error) {
      if (error instanceof InventoryReservationUnavailableError) throw error;
      throw error;
    }
  }

  async expirePendingOrders(now: Date) {
    return this.#sql.begin(async (sql) => {
      const rows = await sql<
        Array<{ orderId: string; identityId: string; reservationId: string }>
      >`
        select id as "orderId", identity_id as "identityId",
          reservation_id as "reservationId"
        from order_orders
        where status = 'PENDING_PAYMENT' and reservation_expires_at <= ${now}
        order by reservation_expires_at
        for update skip locked
        limit 100
      `;
      let expired = 0;
      for (const row of rows) {
        const released = await this.inventory.releaseExpiredReservation(
          sql as unknown as InventoryTransactionContext,
          { reservationId: row.reservationId, expiredAt: now },
        );
        if (!released) continue;
        await sql`
          update order_orders set status = 'EXPIRED'
          where id = ${row.orderId} and status = 'PENDING_PAYMENT'
        `;
        const expiryCauseId = randomUUID();
        await enqueueOutboxEvent(
          sql,
          orderExpiredV1Contract.parse({
            eventId: randomUUID(),
            version: 1,
            eventType: "OrderExpired.v1",
            aggregateId: row.orderId,
            aggregateVersion: 2,
            occurredAt: now.toISOString(),
            correlationId: expiryCauseId,
            causationId: expiryCauseId,
            actor: { type: "SYSTEM" },
            payload: { status: "EXPIRED" },
          }),
        );
        expired += 1;
      }
      return expired;
    });
  }

  async lockPaymentOrder(
    transaction: OrderPaymentTransactionContext,
    identityId: IdentityId,
    orderId: OrderId,
  ) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<
      Array<{
        orderId: OrderId;
        reservationId: string;
        totalAmount: number;
        reservationExpiresAt: Date;
        status: "PENDING_PAYMENT" | "PAYMENT_REVIEW" | "PAID" | "EXPIRED";
      }>
    >`
      select id as "orderId", reservation_id as "reservationId",
        total_amount::float8 as "totalAmount",
        reservation_expires_at as "reservationExpiresAt", status
      from order_orders
      where id = ${orderId} and identity_id = ${identityId}
      for update
    `;
    return rows[0];
  }

  async lockPaymentResultOrder(
    transaction: OrderPaymentTransactionContext,
    identityId: IdentityId,
    orderId: OrderId,
  ) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<
      Array<{
        orderId: OrderId;
        reservationId: string;
        totalAmount: number;
        reservationExpiresAt: Date;
        status: "PENDING_PAYMENT" | "PAYMENT_REVIEW" | "EXPIRED";
      }>
    >`
      select id as "orderId", reservation_id as "reservationId",
        total_amount::float8 as "totalAmount",
        reservation_expires_at as "reservationExpiresAt", status
      from order_orders
      where id = ${orderId} and identity_id = ${identityId}
        and status in ('PENDING_PAYMENT', 'PAYMENT_REVIEW', 'EXPIRED')
      for update
    `;
    return rows[0];
  }

  async checkConversationOrder(
    input: Parameters<OrderConversationEligibility["checkConversationOrder"]>[0],
  ) {
    const parsed = orderConversationEligibilityInputContract.safeParse(input);
    if (!parsed.success) return false;
    const { identityId, orderId, storeId } = parsed.data;
    const rows = await this.#sql`
      select 1 from order_orders
      where id = ${orderId} and identity_id = ${identityId} and store_id = ${storeId}
    `;
    return rows.length === 1;
  }

  async readBuyerPaymentState(identityId: IdentityId, orderId: OrderId) {
    const rows = await this.#sql<
      Array<{
        status: "PENDING_PAYMENT" | "PAYMENT_REVIEW" | "PAID" | "EXPIRED";
        reservationExpiresAt: Date;
      }>
    >`
      select status, reservation_expires_at as "reservationExpiresAt"
      from order_orders
      where id = ${orderId} and identity_id = ${identityId}
    `;
    return rows[0];
  }

  async markPaid(
    transaction: OrderPaymentTransactionContext,
    command: Parameters<OrderPaymentWorkflow["markPaid"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const current = await sql<
      Array<{
        status: "PENDING_PAYMENT" | "PAYMENT_REVIEW";
        storeId: string;
        totalAmount: number;
        currency: "IRR";
      }>
    >`
      select status, store_id as "storeId", total_amount::float8 as "totalAmount",
        currency
      from order_orders
      where id = ${command.orderId}
        and status in ('PENDING_PAYMENT', 'PAYMENT_REVIEW')
      for update
    `;
    if (!current[0]) throw new CheckoutRevisionExpiredError();
    const updated = await sql<Array<{ orderId: string }>>`
      update order_orders set status = 'PAID', paid_at = ${command.paidAt}
      where id = ${command.orderId}
        and status = ${current[0].status}
      returning id as "orderId"
    `;
    if (!updated[0]) throw new CheckoutRevisionExpiredError();
    await sql`
      insert into order_state_transitions
        (id, order_id, from_status, to_status, reason_code, actor_kind,
         correlation_id, occurred_at)
      values
        (${randomUUID()}, ${command.orderId}, ${current[0].status}, 'PAID',
         'PAYMENT_CONFIRMED', 'PAYMENTS_SERVICE', ${command.correlationId},
         ${command.paidAt})
    `;
    await enqueueOutboxEvent(
      sql,
      orderBecameActionableV1Contract.parse({
        eventId: randomUUID(),
        version: 1,
        eventType: "OrderBecameActionable.v1",
        aggregateId: command.orderId,
        aggregateVersion: 2,
        occurredAt: command.paidAt.toISOString(),
        correlationId: eventCorrelationId(command.correlationId),
        causationId: command.attemptId,
        actor: { type: "SYSTEM" },
        payload: { status: "PAID" },
      }),
    );
    await enqueueOutboxEvent(
      sql,
      orderReportingSnapshotV1Contract.parse({
        eventId: randomUUID(),
        version: 1,
        eventType: "OrderReportingSnapshot.v1",
        aggregateId: command.orderId,
        aggregateVersion: 2,
        occurredAt: command.paidAt.toISOString(),
        correlationId: eventCorrelationId(command.correlationId),
        causationId: command.attemptId,
        actor: { type: "SYSTEM" },
        payload: {
          storeId: current[0].storeId,
          status: "PAID",
          total: {
            amount: current[0].totalAmount,
            currency: current[0].currency,
          },
          paidAt: command.paidAt.toISOString(),
        },
      }),
    );
  }

  async listActionableByStore(storeId: StoreId) {
    const rows = await this.#sql<
      Array<{
        orderId: string;
        totalAmount: number;
        paidAt: Date;
        createdAt: Date;
        itemCount: number;
      }>
    >`
      select orders.id as "orderId", orders.total_amount::float8 as "totalAmount",
        orders.paid_at as "paidAt", orders.created_at as "createdAt",
        count(items.variant_id)::int as "itemCount"
      from order_orders orders
      join order_items items on items.order_id = orders.id
      where orders.store_id = ${storeId} and orders.status = 'PAID'
      group by orders.id
      order by orders.paid_at, orders.id
    `;
    return rows.map((row) =>
      sellerActionableOrderContract.parse({
        orderId: row.orderId,
        status: "PAID",
        total: { amount: row.totalAmount, currency: "IRR" },
        paidAt: row.paidAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        itemCount: row.itemCount,
      }),
    );
  }

  async markPaymentReview(
    transaction: OrderPaymentTransactionContext,
    command: Parameters<OrderPaymentWorkflow["markPaymentReview"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const current = await sql<
      Array<{ status: "PENDING_PAYMENT" | "EXPIRED" | "PAYMENT_REVIEW" }>
    >`
      select status from order_orders
      where id = ${command.orderId}
        and status in ('PENDING_PAYMENT', 'EXPIRED', 'PAYMENT_REVIEW')
      for update
    `;
    if (!current[0]) throw new CheckoutRevisionExpiredError();
    if (current[0].status === "PAYMENT_REVIEW") return;
    const updated = await sql<Array<{ orderId: string }>>`
      update order_orders set status = 'PAYMENT_REVIEW'
      where id = ${command.orderId} and status = ${current[0].status}
      returning id as "orderId"
    `;
    if (!updated[0]) throw new CheckoutRevisionExpiredError();
    await sql`
      insert into order_state_transitions
        (id, order_id, from_status, to_status, reason_code, actor_kind,
         correlation_id, occurred_at)
      values
        (${randomUUID()}, ${command.orderId}, ${current[0].status}, 'PAYMENT_REVIEW',
         ${command.reasonCode}, 'PAYMENTS_SERVICE', ${command.correlationId},
         ${command.occurredAt})
    `;
    await enqueueOutboxEvent(
      sql,
      orderPaymentReviewRequiredV1Contract.parse({
        eventId: randomUUID(),
        version: 1,
        eventType: "OrderPaymentReviewRequired.v1",
        aggregateId: command.orderId,
        aggregateVersion: current[0].status === "EXPIRED" ? 3 : 2,
        occurredAt: command.occurredAt.toISOString(),
        correlationId: eventCorrelationId(command.correlationId),
        causationId: command.attemptId,
        actor: { type: "SYSTEM" },
        payload: { status: "PAYMENT_REVIEW" },
      }),
    );
  }

  async resolvePaymentFailure(
    transaction: OrderPaymentTransactionContext,
    command: Parameters<OrderPaymentWorkflow["resolvePaymentFailure"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<
      Array<{
        fromStatus: "PENDING_PAYMENT" | "PAYMENT_REVIEW";
        toStatus: "PENDING_PAYMENT" | "EXPIRED";
      }>
    >`
      with current as (
        select id, status, reservation_expires_at
        from order_orders
        where id = ${command.orderId}
          and status in ('PENDING_PAYMENT', 'PAYMENT_REVIEW')
      )
      update order_orders orders
      set status = case
        when current.reservation_expires_at > ${command.occurredAt}
        then 'PENDING_PAYMENT' else 'EXPIRED' end
      from current where orders.id = current.id
      returning current.status as "fromStatus", orders.status as "toStatus"
    `;
    const changed = rows[0];
    if (!changed) throw new CheckoutRevisionExpiredError();
    if (changed.fromStatus !== changed.toStatus) {
      await sql`
        insert into order_state_transitions
          (id, order_id, from_status, to_status, reason_code, actor_kind,
           correlation_id, occurred_at)
        values
          (${randomUUID()}, ${command.orderId}, ${changed.fromStatus},
           ${changed.toStatus}, 'PAYMENT_FAILED', 'PAYMENTS_SERVICE',
           ${command.correlationId}, ${command.occurredAt})
      `;
    }
    if (changed.toStatus === "EXPIRED") {
      await enqueueOutboxEvent(
        sql,
        orderExpiredV1Contract.parse({
          eventId: randomUUID(),
          version: 1,
          eventType: "OrderExpired.v1",
          aggregateId: command.orderId,
          aggregateVersion: 3,
          occurredAt: command.occurredAt.toISOString(),
          correlationId: command.correlationId,
          causationId: command.attemptId,
          actor: { type: "SYSTEM" },
          payload: { status: "EXPIRED" },
        }),
      );
    }
    return changed.toStatus;
  }

  async markPaidStockConflict(
    transaction: OrderPaymentTransactionContext,
    command: Parameters<OrderPaymentWorkflow["markPaidStockConflict"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<Array<{ fromStatus: string }>>`
      with current as (
        select id, status from order_orders
        where id = ${command.orderId}
          and status in ('PENDING_PAYMENT', 'PAYMENT_REVIEW', 'EXPIRED')
      )
      update order_orders orders set status = 'PAYMENT_REVIEW'
      from current where orders.id = current.id
      returning current.status as "fromStatus"
    `;
    const changed = rows[0];
    if (!changed) throw new CheckoutRevisionExpiredError();
    await sql`
      insert into order_state_transitions
        (id, order_id, from_status, to_status, reason_code, actor_kind,
         correlation_id, occurred_at)
      values
        (${randomUUID()}, ${command.orderId}, ${changed.fromStatus}, 'PAYMENT_REVIEW',
         'PAID_STOCK_CONFLICT', 'PAYMENTS_SERVICE', ${command.correlationId},
         ${command.occurredAt})
    `;
    await enqueueOutboxEvent(
      sql,
      orderPaymentReviewRequiredV1Contract.parse({
        eventId: randomUUID(),
        version: 1,
        eventType: "OrderPaymentReviewRequired.v1",
        aggregateId: command.orderId,
        aggregateVersion: 3,
        occurredAt: command.occurredAt.toISOString(),
        correlationId: command.correlationId,
        causationId: command.attemptId,
        actor: { type: "SYSTEM" },
        payload: { status: "PAYMENT_REVIEW" },
      }),
    );
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

async function completeOrderIdempotency(
  sql: Sql,
  command: Parameters<CheckoutRepository["createOrder"]>[0],
  result: unknown,
) {
  await sql`
    update order_create_idempotency_records
    set state = 'COMPLETED', locked_until = now(), completed_at = now(),
      response_json = ${sql.json(asJson(result))}
    where identity_id = ${command.identityId} and key = ${command.idempotencyKey}
  `;
}

async function assertAuthoritativeReview(
  sql: Sql,
  review: ReturnType<typeof checkoutPreparationContract.parse>,
  products: ProductAuthoritativeRead | undefined,
  stores: StoreAuthoritativeRead | undefined,
  createProductTransactionContext:
    ((transaction: Sql) => OpaqueProductTransactionContext) | undefined,
  createStoreTransactionContext:
    ((transaction: Sql) => OpaqueStoreTransactionContext) | undefined,
) {
  if (
    !products?.readAuthoritativeVariantInTransaction ||
    !stores?.readStoreInTransaction ||
    !createProductTransactionContext ||
    !createStoreTransactionContext
  ) {
    throw new Error("Transactional checkout readers are not configured");
  }
  const changes: CheckoutChangedError["changes"] = [];
  const store = await stores.readStoreInTransaction(
    createStoreTransactionContext(sql),
    review.store.storeId,
  );
  const shipping = store?.shippingMethods.find(
    (method) => method.id === review.shippingMethod.id,
  );
  if (
    !store ||
    store.publicationStatus !== "PUBLISHED" ||
    store.settlement?.mode !== "DIRECT" ||
    store.settlement.status !== "TEST_VERIFIED"
  ) {
    changes.push({ kind: "POLICY_CHANGED" });
  } else {
    if (
      store.returnPolicy?.revision !== review.returnPolicy.revision ||
      store.returnPolicy.text !== review.returnPolicy.text
    ) {
      changes.push({ kind: "POLICY_CHANGED" });
    }
    if (
      !shipping?.enabled ||
      shipping.revision !== review.shippingMethod.revision ||
      shipping.fixedFee.currency !== "IRR"
    ) {
      changes.push({ kind: "SHIPPING_METHOD_CHANGED" });
    } else if (shipping.fixedFee.amount !== review.shippingMethod.fee.amount) {
      changes.push({ kind: "SHIPPING_FEE_CHANGED" });
    }
  }

  const productTransaction = createProductTransactionContext(sql);
  for (const item of review.items) {
    const product = await products.readAuthoritativeVariantInTransaction(
      productTransaction,
      item.variantId,
    );
    if (
      !product ||
      !product.sellable ||
      product.storeId !== review.store.storeId ||
      product.productId !== item.productId ||
      product.publicationVersion !== item.publicationVersion ||
      product.unitPrice.currency !== "IRR"
    ) {
      changes.push({ kind: "VARIANT_UNAVAILABLE", variantId: item.variantId });
    } else if (product.unitPrice.amount !== item.unitPrice.amount) {
      changes.push({
        kind: "PRICE_CHANGED",
        variantId: item.variantId,
        previous: item.unitPrice,
        current: product.unitPrice,
      });
    }
  }
  if (changes.length) throw new CheckoutChangedError(changes);
}

async function readAddress(
  sql: Sql,
  identityId: IdentityId,
  addressId: string,
  revision: number | undefined,
) {
  if (!revision) return undefined;
  const rows = await sql<
    Array<{
      recipientName: string;
      recipientMobile: string;
      provinceText: string;
      cityText: string;
      addressLine: string;
      postalCode: string | null;
    }>
  >`
    select revision.recipient_name as "recipientName",
      revision.recipient_mobile as "recipientMobile",
      revision.province_text as "provinceText", revision.city_text as "cityText",
      revision.address_line as "addressLine", revision.postal_code as "postalCode"
    from order_saved_addresses address
    join order_saved_address_revisions revision
      on revision.address_id = address.id and revision.revision = ${revision}
    where address.id = ${addressId} and address.identity_id = ${identityId}
      and address.status = 'ACTIVE' and address.current_revision = ${revision}
    for update of address
  `;
  return rows[0];
}

function asJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
