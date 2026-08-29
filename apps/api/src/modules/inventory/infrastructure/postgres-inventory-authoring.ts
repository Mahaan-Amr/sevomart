import { randomUUID } from "node:crypto";

import postgres, { type JSONValue, type Sql } from "postgres";
import {
  variantIdContract,
  type ProductId,
  type VariantId,
} from "@sevo/contracts/platform/v1";
import {
  inventoryAvailabilityReadV1Contract,
  sellerInventoryBatchResultContract,
  variantAvailabilityChangedV1Contract,
} from "@sevo/contracts/inventory/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";

import {
  InventoryBatchConflictError,
  InventoryNotFoundError,
  InventoryRevisionConflictError,
  InventoryReservationUnavailableError,
  InventoryReservationNotConsumableError,
  InventoryReservedStockConflictError,
  InventoryIdempotencyConflictError,
  type InventoryAuthoring,
  type InventoryBatchConflictIssue,
  type InventorySnapshot,
  type InventoryTransactionContext,
  type SellerInventoryRepository,
} from "../public";

export class PostgresInventoryAuthoring
  implements InventoryAuthoring, SellerInventoryRepository
{
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 3 });
  }

  async replaceForProduct(
    transaction: InventoryTransactionContext,
    command: Parameters<InventoryAuthoring["replaceForProduct"]>[1],
  ): Promise<InventorySnapshot> {
    let result: (InventorySnapshot & { variantId: VariantId }) | undefined;
    try {
      [result] = await this.replaceBatchForProduct(transaction, {
        storeId: command.storeId,
        rows: [
          {
            variantId: command.variantId,
            onHand: command.onHand,
            expectedRevision: command.expectedRevision,
          },
        ],
        reasonCode: command.reasonCode,
        actorId: command.actorId,
        correlationId: command.correlationId,
      });
    } catch (error) {
      if (error instanceof InventoryBatchConflictError) {
        const issue = error.issues[0]!;
        if (issue.code === "REVISION_CONFLICT") {
          throw new InventoryRevisionConflictError(
            issue.expectedRevision,
            issue.currentRevision,
          );
        }
        throw new InventoryReservedStockConflictError(
          issue.requestedOnHand,
          issue.reserved,
        );
      }
      throw error;
    }
    return {
      onHand: result!.onHand,
      reserved: result!.reserved,
      available: result!.available,
      revision: result!.revision,
    };
  }

  async read(variantId: string): Promise<InventorySnapshot | undefined> {
    return this.readInTransaction(
      this.#sql as unknown as InventoryTransactionContext,
      variantId,
    );
  }

  async replaceBatchForProduct(
    transaction: InventoryTransactionContext,
    command: Parameters<InventoryAuthoring["replaceBatchForProduct"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const ordered = [...command.rows].sort((left, right) =>
      left.variantId.localeCompare(right.variantId),
    );
    const currentRows = ordered.length
      ? await sql<Array<{ variantId: string; onHand: number; revision: number }>>`
          select variant_id as "variantId", on_hand as "onHand", revision
          from inventory_levels
          where variant_id in ${sql(ordered.map((row) => row.variantId))}
          order by variant_id
          for update
        `
      : [];
    const currentById = new Map(
      currentRows.map((row) => [
        row.variantId,
        { onHand: row.onHand, revision: row.revision },
      ]),
    );
    const reservationRows = ordered.length
      ? await sql<Array<{ variantId: string; reserved: number }>>`
          select line.variant_id as "variantId",
            coalesce(sum(line.quantity), 0)::int as reserved
          from inventory_reservation_lines line
          join inventory_reservations reservation
            on reservation.id = line.reservation_id
          where line.variant_id in ${sql(ordered.map((row) => row.variantId))}
            and ${activeReservationPredicate(sql)}
          group by line.variant_id
        `
      : [];
    const reservedById = new Map(
      reservationRows.map((row) => [row.variantId, row.reserved]),
    );
    const conflicts = command.rows.flatMap((row, rowIndex) => {
      const current = currentById.get(row.variantId) ?? { onHand: 0, revision: 0 };
      const issues: InventoryBatchConflictIssue[] = [];
      if (current.revision !== row.expectedRevision) {
        issues.push({
          code: "REVISION_CONFLICT" as const,
          rowIndex,
          variantId: row.variantId,
          expectedRevision: row.expectedRevision,
          currentRevision: current.revision,
        });
      }
      const reserved = reservedById.get(row.variantId) ?? 0;
      if (row.onHand < reserved) {
        issues.push({
          code: "RESERVED_STOCK_CONFLICT" as const,
          rowIndex,
          variantId: row.variantId,
          requestedOnHand: row.onHand,
          reserved,
        });
      }
      return issues;
    });
    if (conflicts.length > 0) {
      if (!command.aggregateBatchConflicts) {
        const issue = conflicts[0]!;
        if (issue.code === "REVISION_CONFLICT") {
          throw new InventoryRevisionConflictError(
            issue.expectedRevision,
            issue.currentRevision,
          );
        }
        throw new InventoryReservedStockConflictError(
          issue.requestedOnHand,
          issue.reserved,
        );
      }
      throw new InventoryBatchConflictError(conflicts);
    }
    const results: Array<InventorySnapshot & { variantId: VariantId }> = [];
    for (const row of ordered) {
      const current = currentById.get(row.variantId) ?? { onHand: 0, revision: 0 };
      const revision = current.revision + 1;
      const updated = await sql<Array<{ onHand: number; revision: number }>>`
        insert into inventory_levels
          (variant_id, store_id, on_hand, revision, updated_at)
        values
          (${row.variantId}, ${command.storeId}, ${row.onHand}, ${revision}, now())
        on conflict (variant_id) do update set
          on_hand = excluded.on_hand, revision = excluded.revision,
          updated_at = excluded.updated_at
        returning on_hand as "onHand", revision
      `;
      await sql`
        insert into inventory_adjustments
          (id, variant_id, store_id, actor_identity_id, reason_code,
           previous_on_hand, next_on_hand, revision, operation,
           previous_revision, next_revision, correlation_id, note)
        values
          (${randomUUID()}, ${row.variantId}, ${command.storeId}, ${command.actorId},
           ${command.reasonCode}, ${current.onHand}, ${row.onHand}, ${revision},
           'REPLACE_ON_HAND', ${current.revision}, ${revision},
           ${command.correlationId}, ${command.note ?? null})
      `;
      const reserved = reservedById.get(row.variantId) ?? 0;
      const wasAvailable = current.onHand - reserved > 0;
      const isAvailable = updated[0]!.onHand - reserved > 0;
      const publication =
        command.publications?.get(row.variantId) ?? command.publication;
      if (publication && wasAvailable !== isAvailable) {
        await enqueueOutboxEvent(
          sql,
          variantAvailabilityChangedV1Contract.parse({
            version: 1,
            eventId: randomUUID(),
            eventType: "VariantAvailabilityChanged.v1",
            aggregateId: row.variantId,
            aggregateVersion: revision,
            occurredAt: new Date().toISOString(),
            correlationId: command.correlationId,
            causationId: command.causationId ?? command.correlationId,
            actor: { type: "IDENTITY", id: command.actorId },
            payload: {
              storeId: command.storeId,
              productId: publication.productId,
              publicationVersion: publication.publicationVersion,
              variantId: row.variantId,
              availabilityVersion: revision,
              availability: isAvailable ? "AVAILABLE" : "OUT_OF_STOCK",
            },
          }),
        );
      }
      results.push({
        variantId: variantIdContract.parse(row.variantId),
        ...updated[0]!,
        reserved: reservedById.get(row.variantId) ?? 0,
        available: updated[0]!.onHand - (reservedById.get(row.variantId) ?? 0),
      });
    }
    return results;
  }

  async listForStore(
    command: Parameters<SellerInventoryRepository["listForStore"]>[0],
  ) {
    const rows = await this.#sql<
      Array<{
        variantId: string;
        onHand: number;
        reserved: number;
        available: number;
        revision: number;
      }>
    >`
      select level.variant_id as "variantId", level.on_hand as "onHand",
        ${reservedQuantity(this.#sql)}::int as reserved,
        (level.on_hand - ${reservedQuantity(this.#sql)})::int as available,
        level.revision
      from inventory_levels level
      left join inventory_reservation_lines line on line.variant_id = level.variant_id
      left join inventory_reservations reservation on reservation.id = line.reservation_id
      where level.store_id = ${command.storeId}::uuid
        ${command.cursor ? this.#sql`and level.variant_id > ${command.cursor}::uuid` : this.#sql``}
      group by level.variant_id
      having ${
        command.availability === "AVAILABLE"
          ? this.#sql`level.on_hand - coalesce(sum(line.quantity) filter (
              where ${activeReservationPredicate(this.#sql)}
            ), 0) > 0`
          : command.availability === "OUT_OF_STOCK"
            ? this.#sql`level.on_hand - coalesce(sum(line.quantity) filter (
                where ${activeReservationPredicate(this.#sql)}
              ), 0) = 0`
            : this.#sql`true`
      }
      order by level.variant_id
      limit ${command.limit + 1}
    `;
    return rows.map(({ variantId, ...snapshot }) => ({
      variantId: variantIdContract.parse(variantId),
      ...inventoryAvailabilityReadV1Contract.parse(snapshot),
    }));
  }

  async replaceSellerBatch(
    command: Parameters<SellerInventoryRepository["replaceSellerBatch"]>[0],
  ) {
    return this.#sql.begin(async (sql) => {
      const operation = "REPLACE_SELLER_INVENTORY_BATCH";
      const claimed = await sql<Array<{ operation: string }>>`
        insert into inventory_idempotency_records
          (operation, actor_identity_id, idempotency_key, request_hash, response_json)
        values
          (${operation}, ${command.actorId}, ${command.idempotencyKey},
           ${command.requestHash}, ${sql.json({})})
        on conflict (operation, actor_identity_id, idempotency_key) do nothing
        returning operation
      `;
      if (!claimed[0]) {
        const records = await sql<Array<{ requestHash: string; response: JSONValue }>>`
          select request_hash as "requestHash", response_json as response
          from inventory_idempotency_records
          where operation = ${operation} and actor_identity_id = ${command.actorId}
            and idempotency_key = ${command.idempotencyKey}
          for update
        `;
        const record = records[0];
        if (!record || record.requestHash !== command.requestHash) {
          throw new InventoryIdempotencyConflictError();
        }
        return sellerInventoryBatchResultContract.parse(record.response);
      }

      const orderedRows = [...command.input.rows].sort((left, right) =>
        left.variantId.localeCompare(right.variantId),
      );
      const productIds = new Map<VariantId, ProductId>();
      const publications = new Map<
        VariantId,
        { productId: ProductId; publicationVersion: number }
      >();
      for (const row of orderedRows) {
        const publication = await command.readPublication(
          sql as unknown as InventoryTransactionContext,
          row.variantId,
        );
        if (!publication || publication.storeId !== command.storeId) {
          throw new InventoryNotFoundError();
        }
        productIds.set(row.variantId, publication.productId);
        if (publication.sellable) {
          publications.set(row.variantId, {
            productId: publication.productId,
            publicationVersion: publication.publicationVersion,
          });
        }
      }
      const results = await this.replaceBatchForProduct(
        sql as unknown as InventoryTransactionContext,
        {
          storeId: command.storeId,
          publications,
          aggregateBatchConflicts: true,
          rows: command.input.rows,
          reasonCode: command.input.reasonCode,
          note: command.input.note,
          actorId: command.actorId,
          correlationId: command.correlationId,
          causationId: command.causationId,
        },
      );
      const adjusted = results.map((result) => ({
        productId: productIds.get(result.variantId)!,
        ...result,
        availability: result.available > 0 ? "AVAILABLE" : "OUT_OF_STOCK",
      }));
      const response = sellerInventoryBatchResultContract.parse({ rows: adjusted });
      await sql`
        update inventory_idempotency_records
        set response_json = ${sql.json(JSON.parse(JSON.stringify(response)) as JSONValue)}
        where operation = ${operation} and actor_identity_id = ${command.actorId}
          and idempotency_key = ${command.idempotencyKey}
      `;
      return response;
    });
  }

  async readMany(variantIds: readonly string[]) {
    if (variantIds.length === 0) return [];
    const rows = await this.#sql<
      Array<{
        variantId: string;
        onHand: number;
        reserved: number;
        available: number;
        revision: number;
      }>
    >`
      select level.variant_id as "variantId", level.on_hand as "onHand",
        ${reservedQuantity(this.#sql)}::int as reserved,
        (level.on_hand - ${reservedQuantity(this.#sql)})::int as available,
        level.revision
      from inventory_levels level
      left join inventory_reservation_lines line on line.variant_id = level.variant_id
      left join inventory_reservations reservation on reservation.id = line.reservation_id
      where level.variant_id in ${this.#sql([...variantIds])}
      group by level.variant_id
      order by level.variant_id
    `;
    return rows.map(({ variantId, ...snapshot }) => ({
      ...inventoryAvailabilityReadV1Contract.parse(snapshot),
      variantId: variantIdContract.parse(variantId),
    }));
  }

  async readInTransaction(transaction: InventoryTransactionContext, variantId: string) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<
      Array<{ onHand: number; reserved: number; available: number; revision: number }>
    >`
      select level.on_hand as "onHand", level.revision,
        ${reservedQuantity(sql)}::int as reserved,
        (level.on_hand - ${reservedQuantity(sql)})::int as available
      from inventory_levels level
      left join inventory_reservation_lines line on line.variant_id = level.variant_id
      left join inventory_reservations reservation on reservation.id = line.reservation_id
      where level.variant_id = ${variantId}::uuid
      group by level.variant_id
    `;
    return rows[0] ? inventoryAvailabilityReadV1Contract.parse(rows[0]) : undefined;
  }

  async reserveForOrder(
    transaction: InventoryTransactionContext,
    command: Parameters<InventoryAuthoring["reserveForOrder"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const ordered = [...command.items].sort((left, right) =>
      left.variantId.localeCompare(right.variantId),
    );
    for (const item of ordered) {
      const levels = await sql<Array<{ onHand: number }>>`
        select on_hand as "onHand" from inventory_levels
        where variant_id = ${item.variantId}::uuid for update
      `;
      const reservations = await sql<Array<{ reserved: number }>>`
        select coalesce(sum(line.quantity), 0)::int as reserved
        from inventory_reservation_lines line
        join inventory_reservations reservation on reservation.id = line.reservation_id
        where line.variant_id = ${item.variantId}
          and ${activeReservationPredicate(sql)}
      `;
      const current = levels[0];
      if (
        !current ||
        current.onHand - (reservations[0]?.reserved ?? 0) < item.quantity
      ) {
        throw new InventoryReservationUnavailableError(item.variantId);
      }
    }
    await sql`
      insert into inventory_reservations
        (id, order_id, store_id, status, expires_at)
      values
        (${command.reservationId}, ${command.orderId}, ${command.storeId},
         'ACTIVE', ${command.expiresAt})
    `;
    for (const item of ordered) {
      await sql`
        insert into inventory_reservation_lines
          (reservation_id, variant_id, quantity)
        values (${command.reservationId}, ${item.variantId}, ${item.quantity})
      `;
    }
  }

  async releaseExpiredReservation(
    transaction: InventoryTransactionContext,
    command: Parameters<InventoryAuthoring["releaseExpiredReservation"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<Array<{ id: string }>>`
      update inventory_reservations
      set status = 'RELEASED'
      where id = ${command.reservationId}::uuid and status = 'ACTIVE'
        and expires_at <= ${command.expiredAt}
        and payment_attempt_id is null
      returning id
    `;
    return rows.length === 1;
  }

  async holdReservationForPayment(
    transaction: InventoryTransactionContext,
    command: Parameters<InventoryAuthoring["holdReservationForPayment"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<Array<{ id: string }>>`
      update inventory_reservations
      set payment_attempt_id = ${command.attemptId},
        hold_lease_until = ${command.leaseUntil}
      where id = ${command.reservationId}::uuid and status = 'ACTIVE'
        and expires_at > ${command.now}
        and (payment_attempt_id is null or payment_attempt_id = ${command.attemptId}::uuid)
      returning id
    `;
    if (rows.length !== 1) throw new InventoryReservationNotConsumableError();
  }

  async consumeReservation(
    transaction: InventoryTransactionContext,
    command: Parameters<InventoryAuthoring["consumeReservation"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const reservations = await sql<Array<{ status: string; attemptId: string | null }>>`
      select status, payment_attempt_id as "attemptId"
      from inventory_reservations
      where id = ${command.reservationId}::uuid
      for update
    `;
    const reservation = reservations[0];
    if (reservation?.status === "CONSUMED") return false;
    if (reservation?.status === "RELEASED") return false;
    if (
      !reservation ||
      !["ACTIVE", "HELD_FOR_REVIEW"].includes(reservation.status) ||
      reservation.attemptId !== command.attemptId
    ) {
      throw new InventoryReservationNotConsumableError();
    }
    const lines = await sql<Array<{ variantId: string; quantity: number }>>`
      select variant_id as "variantId", quantity
      from inventory_reservation_lines
      where reservation_id = ${command.reservationId}::uuid
      order by variant_id
    `;
    for (const line of lines) {
      const updated = await sql<Array<{ variantId: string }>>`
        update inventory_levels
        set on_hand = on_hand - ${line.quantity}, revision = revision + 1,
          updated_at = now()
        where variant_id = ${line.variantId}::uuid and on_hand >= ${line.quantity}
        returning variant_id as "variantId"
      `;
      if (!updated[0]) throw new InventoryReservationNotConsumableError();
    }
    await sql`
      update inventory_reservations
      set status = 'CONSUMED', payment_attempt_id = null, hold_lease_until = null
      where id = ${command.reservationId}::uuid
    `;
    return true;
  }

  async holdReservationForReview(
    transaction: InventoryTransactionContext,
    command: Parameters<InventoryAuthoring["holdReservationForReview"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<Array<{ id: string }>>`
      update inventory_reservations set status = 'HELD_FOR_REVIEW'
      where id = ${command.reservationId}::uuid and status = 'ACTIVE'
        and payment_attempt_id = ${command.attemptId}::uuid
      returning id
    `;
    if (!rows[0]) throw new InventoryReservationNotConsumableError();
  }

  async holdReservationForProviderConflict(
    transaction: InventoryTransactionContext,
    command: Parameters<InventoryAuthoring["holdReservationForProviderConflict"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<Array<{ id: string }>>`
      update inventory_reservations
      set status = 'HELD_FOR_REVIEW', payment_attempt_id = ${command.attemptId}::uuid,
        hold_lease_until = now()
      where id = ${command.reservationId}::uuid and status = 'ACTIVE'
        and payment_attempt_id is null
      returning id
    `;
    return Boolean(rows[0]);
  }

  async resolveFailedPayment(
    transaction: InventoryTransactionContext,
    command: Parameters<InventoryAuthoring["resolveFailedPayment"]>[1],
  ) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<Array<{ status: "ACTIVE" | "RELEASED" }>>`
      update inventory_reservations
      set status = case when expires_at > ${command.now} then 'ACTIVE' else 'RELEASED' end,
        payment_attempt_id = null, hold_lease_until = null
      where id = ${command.reservationId}::uuid
        and status in ('ACTIVE', 'HELD_FOR_REVIEW')
        and payment_attempt_id = ${command.attemptId}::uuid
      returning status
    `;
    if (!rows[0]) throw new InventoryReservationNotConsumableError();
    return rows[0].status;
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

function activeReservationPredicate(sql: Sql) {
  return sql`
    (
      reservation.status = 'HELD_FOR_REVIEW'
      or (
        reservation.status = 'ACTIVE'
        and greatest(
          reservation.expires_at,
          coalesce(reservation.hold_lease_until, reservation.expires_at)
        ) > now()
      )
    )
  `;
}

function reservedQuantity(sql: Sql) {
  return sql`
    coalesce(sum(line.quantity) filter (
      where ${activeReservationPredicate(sql)}
    ), 0)
  `;
}
