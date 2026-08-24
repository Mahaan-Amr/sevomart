import {
  checkoutPreparationContract,
  orderContract,
} from "@sevo/contracts/orders/v1";
import type { IdentityId } from "@sevo/contracts/platform/v1";
import postgres, { type JSONValue, type Sql } from "postgres";

import {
  InventoryReservationUnavailableError,
  type InventoryAuthoring,
  type InventoryTransactionContext,
} from "../../inventory/public";
import {
  CheckoutAddressInvalidError,
  CheckoutChangedError,
  CheckoutIdempotencyConflictError,
  CheckoutRevisionExpiredError,
  type CheckoutRepository,
} from "../public";

type PreparationRow = {
  snapshot: JSONValue;
  expiresAt: Date;
  consumedOrderId: string | null;
};

export class PostgresCheckoutRepository implements CheckoutRepository {
  readonly #sql: Sql;

  constructor(
    databaseUrl: string,
    private readonly inventory: InventoryAuthoring,
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

  async createOrder(command: Parameters<CheckoutRepository["createOrder"]>[0]) {
    try {
      return await this.#sql.begin(async (sql) => {
        await sql`
          select pg_advisory_xact_lock(
            hashtextextended(${`create-order:${command.identityId}:${command.idempotencyKey}`}, 0)
          )
        `;
        const replay = await sql<Array<{ requestHash: string; response: JSONValue }>>`
          select request_hash as "requestHash", response_json as response
          from order_create_idempotency_records
          where identity_id = ${command.identityId} and key = ${command.idempotencyKey}
        `;
        if (replay[0]) {
          if (replay[0].requestHash !== command.requestHash) {
            throw new CheckoutIdempotencyConflictError();
          }
          return orderContract.parse(replay[0].response);
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
          await sql`
            insert into order_create_idempotency_records
              (identity_id, key, request_hash, response_json)
            values
              (${command.identityId}, ${command.idempotencyKey}, ${command.requestHash},
               ${sql.json(asJson(result))})
          `;
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
        const delivery = review.address
          ? await readAddress(
              sql,
              command.identityId,
              review.address.addressId,
              command.input.addressRevision,
            )
          : undefined;
        if (review.address && !delivery) throw new CheckoutAddressInvalidError();

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
               ${review.address!.revision}, ${delivery.recipientName},
               ${delivery.recipientMobile}, ${delivery.provinceText},
               ${delivery.cityText}, ${delivery.addressLine}, ${delivery.postalCode})
          `;
        }
        await sql`
          update order_checkout_preparations
          set consumed_order_id = ${command.orderId}
          where checkout_revision = ${review.checkoutRevision}
        `;
        const createdAt = new Date().toISOString();
        const result = orderContract.parse({
          orderId: command.orderId,
          status: "PENDING_PAYMENT",
          reservationId: command.reservationId,
          reservationExpiresAt: command.reservationExpiresAt.toISOString(),
          createdAt,
          review,
        });
        await sql`
          insert into order_create_idempotency_records
            (identity_id, key, request_hash, response_json)
          values
            (${command.identityId}, ${command.idempotencyKey}, ${command.requestHash},
             ${sql.json(asJson(result))})
        `;
        return result;
      });
    } catch (error) {
      if (error instanceof InventoryReservationUnavailableError) throw error;
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
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
