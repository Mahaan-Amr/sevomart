import { createHash, randomUUID } from "node:crypto";

import {
  revealedOrderDeliveryDetailsContract,
  storeBuyerOrderPageContract,
  storeBuyerPageContract,
  type OrderStatus,
} from "@sevo/contracts/orders/v1";
import {
  identityIdContract,
  orderIdContract,
  storeIdContract,
} from "@sevo/contracts/platform/v1";
import postgres, { type Sql } from "postgres";

import {
  StoreBuyerCursorCodec,
  StoreBuyerOrderCursorCodec,
  InvalidStoreBuyerCursorError,
} from "../application/store-buyer-cursor";
import { StoreBuyerFault, type RelatedStoreBuyerRead } from "../public";

type BuyerRow = {
  buyerId: string;
  orderCount: number;
  latestOrderId: string;
  paymentStatus: OrderStatus;
  latestCreatedAt: Date;
  recipientName: string | null;
  recipientMobile: string | null;
  fulfillmentStatus: "ACTION_REQUIRED" | "PREPARING" | "SHIPPED" | "DELIVERED" | null;
  matchedOrderId: string | null;
};

type DeliveryRow = {
  recipientName: string;
  recipientMobile: string;
  provinceText: string;
  cityText: string;
  addressLine: string;
  postalCode: string | null;
};

type BuyerOrderRow = {
  orderId: string;
  paymentStatus: OrderStatus;
  fulfillmentStatus: BuyerRow["fulfillmentStatus"];
  createdAt: Date;
};

export class PostgresRelatedStoreBuyerRepository implements RelatedStoreBuyerRead {
  readonly #sql: Sql;
  readonly #cursor: StoreBuyerCursorCodec;
  readonly #orderCursor: StoreBuyerOrderCursorCodec;

  constructor(databaseUrl: string, cursorSecret: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
    this.#cursor = new StoreBuyerCursorCodec(cursorSecret);
    this.#orderCursor = new StoreBuyerOrderCursorCodec(cursorSecret);
  }

  async listStoreBuyerOrders(
    input: Parameters<RelatedStoreBuyerRead["listStoreBuyerOrders"]>[0],
  ) {
    const contextOrders = await this.#sql<Array<{ buyerId: string }>>`
      select identity_id as "buyerId" from order_orders
      where id = ${input.contextOrderId} and store_id = ${input.storeId}
    `;
    const contextOrder = contextOrders[0];
    if (!contextOrder) throw new StoreBuyerFault("ORDER_NOT_FOUND");
    const cursor = input.query.cursor
      ? this.#decodeOrderCursor(input.storeId, input.contextOrderId, input.query.cursor)
      : undefined;
    const rows = await this.#sql<BuyerOrderRow[]>`
      select orders.id as "orderId", orders.status as "paymentStatus",
        fulfillment.status as "fulfillmentStatus", orders.created_at as "createdAt"
      from order_orders orders
      left join order_fulfillment_status_projections fulfillment
        on fulfillment.order_id = orders.id
      where orders.store_id = ${input.storeId}
        and orders.identity_id = ${contextOrder.buyerId}
        ${
          cursor
            ? this.#sql`
                and (orders.created_at, orders.id)
                  < (${new Date(cursor.createdAt)}, ${cursor.orderId}::uuid)
              `
            : this.#sql``
        }
      order by orders.created_at desc, orders.id desc
      limit ${input.query.limit + 1}
    `;
    const pageRows = rows.slice(0, input.query.limit);
    const last = pageRows.at(-1);
    return storeBuyerOrderPageContract.parse({
      items: pageRows.map((row) => ({
        orderId: orderIdContract.parse(row.orderId),
        paymentStatus: row.paymentStatus,
        ...(row.fulfillmentStatus ? { fulfillmentStatus: row.fulfillmentStatus } : {}),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > input.query.limit && last
          ? this.#orderCursor.encode(
              { storeId: input.storeId, contextOrderId: input.contextOrderId },
              {
                orderId: orderIdContract.parse(last.orderId),
                createdAt: last.createdAt.toISOString(),
              },
            )
          : null,
    });
  }

  async listStoreBuyers(
    input: Parameters<RelatedStoreBuyerRead["listStoreBuyers"]>[0],
  ) {
    const cursor = input.query.cursor
      ? this.#decodeCursor(input.storeId, input.query.search, input.query.cursor)
      : undefined;
    const searchPattern = input.query.search
      ? `%${escapeLike(input.query.search)}%`
      : undefined;
    const rows = await this.#sql<BuyerRow[]>`
      with buyer_rollup as (
        select orders.identity_id as "buyerId", count(*)::int as "orderCount",
          ${
            searchPattern
              ? this.#sql`
                  (
                    select searched.id from order_orders searched
                    left join order_delivery_snapshots searched_delivery
                      on searched_delivery.order_id = searched.id
                    where searched.store_id = ${input.storeId}
                      and searched.identity_id = orders.identity_id
                      and (
                        searched.id::text ilike ${searchPattern} escape '\\'
                        or searched_delivery.recipient_name ilike ${searchPattern} escape '\\'
                      )
                    order by searched.created_at desc, searched.id desc
                    limit 1
                  )
                `
              : this.#sql`null::uuid`
          } as "matchedOrderId"
        from order_orders orders
        where orders.store_id = ${input.storeId}
          ${
            searchPattern
              ? this.#sql`
                  and exists (
                    select 1 from order_orders searched
                    left join order_delivery_snapshots searched_delivery
                      on searched_delivery.order_id = searched.id
                    where searched.store_id = orders.store_id
                      and searched.identity_id = orders.identity_id
                      and (
                        searched.id::text ilike ${searchPattern} escape '\\'
                        or searched_delivery.recipient_name ilike ${searchPattern} escape '\\'
                      )
                  )
                `
              : this.#sql``
          }
        group by orders.identity_id
      ), latest_order as (
        select distinct on (orders.identity_id)
          orders.identity_id as "buyerId", orders.id as "latestOrderId",
          orders.status as "paymentStatus", orders.created_at as "latestCreatedAt"
        from order_orders orders
        where orders.store_id = ${input.storeId}
        order by orders.identity_id, orders.created_at desc, orders.id desc
      )
      select rollup."buyerId", rollup."orderCount", rollup."matchedOrderId",
        latest."latestOrderId",
        latest."paymentStatus", latest."latestCreatedAt",
        contact.recipient_name as "recipientName",
        contact.recipient_mobile as "recipientMobile",
        fulfillment.status as "fulfillmentStatus"
      from buyer_rollup rollup
      join latest_order latest on latest."buyerId" = rollup."buyerId"
      left join lateral (
        select delivery.recipient_name, delivery.recipient_mobile
        from order_orders contact_order
        join order_delivery_snapshots delivery on delivery.order_id = contact_order.id
        where contact_order.store_id = ${input.storeId}
          and contact_order.identity_id = rollup."buyerId"
        order by contact_order.created_at desc, contact_order.id desc
        limit 1
      ) contact on true
      left join order_fulfillment_status_projections fulfillment
        on fulfillment.order_id = latest."latestOrderId"
      ${
        cursor
          ? this.#sql`
              where (latest."latestCreatedAt", rollup."buyerId")
                < (${new Date(cursor.createdAt)}, ${cursor.buyerId}::uuid)
            `
          : this.#sql``
      }
      order by latest."latestCreatedAt" desc, rollup."buyerId" desc
      limit ${input.query.limit + 1}
    `;
    const pageRows = rows.slice(0, input.query.limit);
    const items = pageRows.map((row) => {
      const orderId = orderIdContract.parse(row.latestOrderId);
      return {
        buyerId: identityIdContract.parse(row.buyerId),
        displayName: maskName(row.recipientName),
        ...(row.recipientMobile
          ? { maskedMobile: maskMobile(row.recipientMobile) }
          : {}),
        orderCount: row.orderCount,
        ...(row.matchedOrderId
          ? { matchedOrderId: orderIdContract.parse(row.matchedOrderId) }
          : {}),
        latestOrder: {
          orderId,
          paymentStatus: row.paymentStatus,
          ...(row.fulfillmentStatus
            ? { fulfillmentStatus: row.fulfillmentStatus }
            : {}),
          createdAt: row.latestCreatedAt.toISOString(),
        },
      };
    });
    const last = pageRows.at(-1);
    return storeBuyerPageContract.parse({
      items,
      nextCursor:
        rows.length > input.query.limit && last
          ? this.#cursor.encode(
              { storeId: input.storeId, search: input.query.search },
              {
                buyerId: identityIdContract.parse(last.buyerId),
                createdAt: last.latestCreatedAt.toISOString(),
              },
            )
          : null,
    });
  }

  async revealOrderDeliveryDetails(
    input: Parameters<RelatedStoreBuyerRead["revealOrderDeliveryDetails"]>[0],
  ) {
    return this.#sql.begin(async (sql) => {
      const orders = await sql<Array<{ orderId: string }>>`
        select id as "orderId" from order_orders
        where id = ${input.orderId} and store_id = ${input.storeId}
          and status = 'PAID'
        for share
      `;
      if (!orders[0]) throw new StoreBuyerFault("ORDER_NOT_FOUND");
      const fulfillmentRows = await sql<
        Array<{
          status: "ACTION_REQUIRED" | "PREPARING" | "SHIPPED" | "DELIVERED";
        }>
      >`
        select status from order_fulfillment_status_projections
        where order_id = ${input.orderId}
        for share
      `;
      const fulfillmentStatus = fulfillmentRows[0]?.status;
      if (!input.reason) {
        throw new StoreBuyerFault("REVEAL_REASON_REQUIRED");
      }
      const deliveries = await sql<DeliveryRow[]>`
        select recipient_name as "recipientName",
          recipient_mobile as "recipientMobile", province_text as "provinceText",
          city_text as "cityText", address_line as "addressLine",
          postal_code as "postalCode"
        from order_delivery_snapshots where order_id = ${input.orderId}
        for share
      `;
      const delivery = deliveries[0];
      if (!delivery) {
        throw new StoreBuyerFault("DELIVERY_DETAILS_NOT_AVAILABLE");
      }
      await sql`
        insert into order_sensitive_access_audit
          (id, actor_identity_id, store_id, order_id, action, reason_code, reason_hash,
           correlation_id, occurred_at)
        values (${randomUUID()}, ${input.actorId}, ${input.storeId}, ${input.orderId},
          'REVEAL_DELIVERY_DETAILS',
          'ORDER_FOLLOW_UP',
          ${createHash("sha256").update(input.reason).digest("hex")},
          ${input.correlationId}, ${input.occurredAt})
      `;
      return revealedOrderDeliveryDetailsContract.parse({
        orderId: input.orderId,
        recipientName: delivery.recipientName,
        recipientMobile: delivery.recipientMobile,
        address: {
          provinceText: delivery.provinceText,
          cityText: delivery.cityText,
          addressLine: delivery.addressLine,
          ...(delivery.postalCode ? { postalCode: delivery.postalCode.trim() } : {}),
        },
        ...(fulfillmentStatus ? { fulfillmentStatus } : {}),
        revealedAt: input.occurredAt.toISOString(),
      });
    });
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }

  #decodeCursor(storeId: string, search: string | undefined, cursor: string) {
    try {
      return this.#cursor.decode(
        { storeId: storeIdContract.parse(storeId), search },
        cursor,
      );
    } catch (error) {
      if (error instanceof InvalidStoreBuyerCursorError) {
        throw new StoreBuyerFault("INVALID_CURSOR");
      }
      throw error;
    }
  }

  #decodeOrderCursor(storeId: string, contextOrderId: string, cursor: string) {
    try {
      return this.#orderCursor.decode(
        {
          storeId: storeIdContract.parse(storeId),
          contextOrderId: orderIdContract.parse(contextOrderId),
        },
        cursor,
      );
    } catch (error) {
      if (error instanceof InvalidStoreBuyerCursorError) {
        throw new StoreBuyerFault("INVALID_CURSOR");
      }
      throw error;
    }
  }
}

function maskName(name: string | null): string {
  if (!name) return "خریدار";
  const [first = "خریدار", second] = name.trim().split(/\s+/u);
  return second ? `${first} ${Array.from(second)[0]}.` : `${Array.from(first)[0]}.`;
}

function maskMobile(mobile: string): string {
  return `${mobile.slice(0, 4)}••••${mobile.slice(-3)}`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
