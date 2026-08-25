import { randomUUID } from "node:crypto";

import {
  directPaymentAttemptConfirmedV1Contract,
  directPaymentAttemptContract,
} from "@sevo/contracts/payments/v1";
import { sellerActionableOrderContract } from "@sevo/contracts/payments/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type Sql } from "postgres";

import type {
  InventoryAuthoring,
  InventoryTransactionContext,
} from "../../inventory/public";
import {
  DirectPaymentAmountMismatchError,
  DirectPaymentAttemptNotFoundError,
  DirectPaymentIdempotencyConflictError,
  DirectPaymentOrderNotPayableError,
  type DirectPaymentRepository,
} from "../public";

type AttemptRow = {
  attemptId: string;
  orderId: string;
  status: "CREATED" | "DISPATCHED" | "CONFIRMED";
  amount: number;
  provider: "DEV";
  providerReference: string | null;
  redirectUrl: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
};

export class PostgresDirectPaymentRepository implements DirectPaymentRepository {
  readonly #sql: Sql;

  constructor(
    databaseUrl: string,
    private readonly inventory: InventoryAuthoring,
  ) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async prepareAttempt(
    command: Parameters<DirectPaymentRepository["prepareAttempt"]>[0],
  ) {
    return this.#sql.begin(async (sql) => {
      const replay = await sql<Array<{ requestHash: string; attemptId: string }>>`
        select request_hash as "requestHash", attempt_id as "attemptId"
        from payment_idempotency_records
        where identity_id = ${command.identityId}::uuid and key = ${command.idempotencyKey}
      `;
      if (replay[0]) {
        if (replay[0].requestHash !== command.requestHash) {
          throw new DirectPaymentIdempotencyConflictError();
        }
        const existing = await readAttempt(sql, replay[0].attemptId);
        if (!existing) throw new DirectPaymentAttemptNotFoundError();
        return mapAttempt(existing);
      }
      const orders = await sql<
        Array<{
          orderId: string;
          reservationId: string;
          status: string;
          totalAmount: number;
          reservationExpiresAt: Date;
        }>
      >`
        select id as "orderId", reservation_id as "reservationId", status,
          total_amount::int as "totalAmount",
          reservation_expires_at as "reservationExpiresAt"
        from order_orders
        where id = ${command.orderId}::uuid and identity_id = ${command.identityId}::uuid
        for update
      `;
      const order = orders[0];
      if (
        !order ||
        order.status !== "PENDING_PAYMENT" ||
        order.reservationExpiresAt.getTime() <= Date.now()
      ) {
        throw new DirectPaymentOrderNotPayableError();
      }
      const active = await sql<AttemptRow[]>`
        select id as "attemptId", order_id as "orderId", status,
          amount::int as amount, provider,
          provider_reference as "providerReference", redirect_url as "redirectUrl",
          created_at as "createdAt", confirmed_at as "confirmedAt"
        from payment_attempts
        where order_id = ${order.orderId}::uuid
          and status in ('CREATED', 'DISPATCHED', 'CONFIRMED')
        for update
      `;
      if (active[0]) return mapAttempt(active[0]);
      await sql`
        insert into payment_attempts
          (id, order_id, identity_id, status, amount, currency, provider)
        values
          (${command.attemptId}, ${order.orderId}, ${command.identityId}, 'CREATED',
           ${order.totalAmount}, 'IRR', 'DEV')
      `;
      await this.inventory.holdReservationForPayment(
        sql as unknown as InventoryTransactionContext,
        {
          reservationId: order.reservationId,
          attemptId: command.attemptId,
          leaseUntil: command.leaseUntil,
          now: new Date(),
        },
      );
      await sql`
        update payment_attempts
        set status = 'DISPATCHED', dispatched_at = now()
        where id = ${command.attemptId}
      `;
      await sql`
        insert into payment_idempotency_records
          (identity_id, key, request_hash, attempt_id)
        values
          (${command.identityId}, ${command.idempotencyKey}, ${command.requestHash},
           ${command.attemptId})
      `;
      return mapAttempt((await readAttempt(sql, command.attemptId))!);
    });
  }

  async recordInitiation(
    command: Parameters<DirectPaymentRepository["recordInitiation"]>[0],
  ) {
    const rows = await this.#sql<AttemptRow[]>`
      update payment_attempts
      set provider_reference = ${command.providerReference},
        redirect_url = ${command.redirectUrl}
      where id = ${command.attemptId}::uuid and status = 'DISPATCHED'
      returning id as "attemptId", order_id as "orderId", status,
        amount::int as amount, provider,
        provider_reference as "providerReference", redirect_url as "redirectUrl",
        created_at as "createdAt", confirmed_at as "confirmedAt"
    `;
    if (!rows[0]) throw new DirectPaymentAttemptNotFoundError();
    return mapAttempt(rows[0]);
  }

  async confirmCallback(
    callback: Parameters<DirectPaymentRepository["confirmCallback"]>[0],
    correlationId: string,
  ) {
    return this.#sql.begin(async (sql) => {
      const attempts = await sql<
        Array<
          AttemptRow & {
            identityId: string;
            reservationId: string;
            totalAmount: number;
          }
        >
      >`
        select attempt.id as "attemptId", attempt.order_id as "orderId",
          attempt.status, attempt.amount::int as amount, attempt.provider,
          attempt.provider_reference as "providerReference",
          attempt.redirect_url as "redirectUrl", attempt.created_at as "createdAt",
          attempt.confirmed_at as "confirmedAt", attempt.identity_id as "identityId",
          orders.reservation_id as "reservationId",
          orders.total_amount::int as "totalAmount"
        from payment_attempts attempt
        join order_orders orders on orders.id = attempt.order_id
        where attempt.id = ${callback.attemptId}::uuid
        for update of attempt, orders
      `;
      const attempt = attempts[0];
      if (
        !attempt ||
        attempt.orderId !== callback.orderId ||
        attempt.providerReference !== callback.providerReference
      ) {
        throw new DirectPaymentAttemptNotFoundError();
      }
      if (
        attempt.amount !== callback.amount ||
        attempt.totalAmount !== callback.amount
      ) {
        throw new DirectPaymentAmountMismatchError();
      }
      const observation = await sql<Array<{ eventId: string }>>`
        insert into payment_provider_observations
          (provider, provider_event_id, attempt_id, provider_reference, result,
           correlation_id)
        values
          ('DEV', ${callback.providerEventId}, ${attempt.attemptId},
           ${callback.providerReference}, 'CONFIRMED', ${correlationId})
        on conflict (provider, provider_event_id) do nothing
        returning provider_event_id as "eventId"
      `;
      if (!observation[0]) {
        const original = await sql<Array<{ attemptId: string }>>`
          select attempt_id as "attemptId"
          from payment_provider_observations
          where provider = 'DEV' and provider_event_id = ${callback.providerEventId}
        `;
        if (
          original[0]?.attemptId !== attempt.attemptId ||
          attempt.status !== "CONFIRMED"
        ) {
          throw new DirectPaymentAttemptNotFoundError();
        }
        return {
          attemptId: attempt.attemptId,
          status: "CONFIRMED" as const,
          duplicate: true,
        };
      }
      if (attempt.status === "CONFIRMED") {
        return {
          attemptId: attempt.attemptId,
          status: "CONFIRMED" as const,
          duplicate: true,
        };
      }
      await this.inventory.consumeReservation(
        sql as unknown as InventoryTransactionContext,
        { reservationId: attempt.reservationId, attemptId: attempt.attemptId },
      );
      const now = new Date();
      await sql`update payment_attempts set status = 'CONFIRMED', confirmed_at = ${now} where id = ${attempt.attemptId}`;
      await sql`update order_orders set status = 'PAID', paid_at = ${now} where id = ${attempt.orderId} and status = 'PENDING_PAYMENT'`;
      await enqueueOutboxEvent(
        sql,
        directPaymentAttemptConfirmedV1Contract.parse({
          eventId: randomUUID(),
          version: 1,
          eventType: "DirectPaymentAttemptConfirmed.v1",
          aggregateId: attempt.orderId,
          aggregateVersion: 2,
          occurredAt: now.toISOString(),
          correlationId,
          causationId: correlationId,
          actor: { type: "SYSTEM" },
          payload: {
            status: "CONFIRMED",
            amount: { amount: attempt.amount, currency: "IRR" },
          },
        }),
      );
      await enqueueOutboxEvent(sql, {
        eventId: randomUUID(),
        version: 1,
        eventType: "OrderBecameActionable.v1",
        aggregateId: attempt.orderId,
        aggregateVersion: 2,
        occurredAt: now.toISOString(),
        correlationId,
        causationId: correlationId,
        actor: { type: "SYSTEM" },
        payload: { status: "PAID" },
      });
      return {
        attemptId: attempt.attemptId,
        status: "CONFIRMED" as const,
        duplicate: false,
      };
    });
  }

  async readAttemptForBuyer(identityId: string, attemptId: string) {
    const rows = await this.#sql<AttemptRow[]>`
      select id as "attemptId", order_id as "orderId", status,
        amount::int as amount, provider,
        provider_reference as "providerReference", redirect_url as "redirectUrl",
        created_at as "createdAt", confirmed_at as "confirmedAt"
      from payment_attempts
      where id = ${attemptId}::uuid and identity_id = ${identityId}::uuid
    `;
    return rows[0] ? mapAttempt(rows[0]) : undefined;
  }

  async listActionableByStore(storeId: string) {
    const rows = await this.#sql<
      Array<{
        orderId: string;
        totalAmount: number;
        paidAt: Date;
        createdAt: Date;
        itemCount: number;
      }>
    >`
      select orders.id as "orderId", orders.total_amount::int as "totalAmount",
        orders.paid_at as "paidAt", orders.created_at as "createdAt",
        count(items.variant_id)::int as "itemCount"
      from order_orders orders
      join order_items items on items.order_id = orders.id
      where orders.store_id = ${storeId}::uuid and orders.status = 'PAID'
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

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

async function readAttempt(sql: Sql, attemptId: string) {
  const rows = await sql<AttemptRow[]>`
    select id as "attemptId", order_id as "orderId", status,
      amount::int as amount, provider,
      provider_reference as "providerReference", redirect_url as "redirectUrl",
      created_at as "createdAt", confirmed_at as "confirmedAt"
    from payment_attempts where id = ${attemptId}::uuid
  `;
  return rows[0];
}

function mapAttempt(row: AttemptRow) {
  return directPaymentAttemptContract.parse({
    attemptId: row.attemptId,
    orderId: row.orderId,
    status: row.status,
    amount: { amount: row.amount, currency: "IRR" },
    provider: row.provider,
    ...(row.providerReference ? { providerReference: row.providerReference } : {}),
    ...(row.redirectUrl ? { redirectUrl: row.redirectUrl } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.toISOString() } : {}),
  });
}
