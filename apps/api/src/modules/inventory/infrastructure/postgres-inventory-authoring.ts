import { randomUUID } from "node:crypto";

import postgres, { type Sql } from "postgres";
import { variantIdContract, type VariantId } from "@sevo/contracts/platform/v1";

import {
  InventoryRevisionConflictError,
  InventoryReservationUnavailableError,
  type InventoryAuthoring,
  type InventorySnapshot,
  type InventoryTransactionContext,
} from "../public";

export class PostgresInventoryAuthoring implements InventoryAuthoring {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 3 });
  }

  async replaceForProduct(
    transaction: InventoryTransactionContext,
    command: {
      storeId: string;
      variantId: string;
      onHand: number;
      expectedRevision: number;
      reasonCode: "INITIAL_STOCK";
      actorId: string;
      correlationId: string;
    },
  ): Promise<InventorySnapshot> {
    const sql = transaction as unknown as Sql;
    const rows = await sql<Array<{ onHand: number; revision: number }>>`
      select on_hand as "onHand", revision from inventory_levels
      where variant_id = ${command.variantId}::uuid for update
    `;
    const reservations = await sql<Array<{ reserved: number }>>`
      select coalesce(sum(line.quantity), 0)::int as reserved
      from inventory_reservation_lines line
      join inventory_reservations reservation on reservation.id = line.reservation_id
      where line.variant_id = ${command.variantId}
        and reservation.status = 'ACTIVE' and reservation.expires_at > now()
    `;
    const current = {
      ...(rows[0] ?? { onHand: 0, revision: 0 }),
      reserved: reservations[0]?.reserved ?? 0,
    };
    if (current.revision !== command.expectedRevision) {
      throw new InventoryRevisionConflictError(
        command.expectedRevision,
        current.revision,
      );
    }
    const revision = current.revision + 1;
    const updated = await sql<Array<{ onHand: number; revision: number }>>`
      insert into inventory_levels
        (variant_id, store_id, on_hand, revision, updated_at)
      values
        (${command.variantId}, ${command.storeId}, ${command.onHand}, ${revision}, now())
      on conflict (variant_id) do update set
        on_hand = excluded.on_hand, revision = excluded.revision,
        updated_at = excluded.updated_at
      returning on_hand as "onHand", revision
    `;
    await sql`
      insert into inventory_adjustments
        (id, variant_id, store_id, actor_identity_id, reason_code,
         previous_on_hand, next_on_hand, revision, correlation_id)
      values
        (${randomUUID()}, ${command.variantId}, ${command.storeId}, ${command.actorId},
         ${command.reasonCode}, ${current.onHand}, ${command.onHand}, ${revision},
         ${command.correlationId})
    `;
    return {
      ...updated[0]!,
      reserved: current.reserved,
      available: updated[0]!.onHand - current.reserved,
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
            and reservation.status = 'ACTIVE' and reservation.expires_at > now()
          group by line.variant_id
        `
      : [];
    const reservedById = new Map(
      reservationRows.map((row) => [row.variantId, row.reserved]),
    );
    for (const row of ordered) {
      const current = currentById.get(row.variantId) ?? { onHand: 0, revision: 0 };
      if (current.revision !== row.expectedRevision) {
        throw new InventoryRevisionConflictError(
          row.expectedRevision,
          current.revision,
        );
      }
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
           previous_on_hand, next_on_hand, revision, correlation_id)
        values
          (${randomUUID()}, ${row.variantId}, ${command.storeId}, ${command.actorId},
           ${command.reasonCode}, ${current.onHand}, ${row.onHand}, ${revision},
           ${command.correlationId})
      `;
      results.push({
        variantId: variantIdContract.parse(row.variantId),
        ...updated[0]!,
        reserved: reservedById.get(row.variantId) ?? 0,
        available: updated[0]!.onHand - (reservedById.get(row.variantId) ?? 0),
      });
    }
    return results;
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
        coalesce(sum(line.quantity) filter (
          where reservation.status = 'ACTIVE' and reservation.expires_at > now()
        ), 0)::int as reserved,
        (level.on_hand - coalesce(sum(line.quantity) filter (
          where reservation.status = 'ACTIVE' and reservation.expires_at > now()
        ), 0))::int as available,
        level.revision
      from inventory_levels level
      left join inventory_reservation_lines line on line.variant_id = level.variant_id
      left join inventory_reservations reservation on reservation.id = line.reservation_id
      where level.variant_id in ${this.#sql([...variantIds])}
      group by level.variant_id
      order by level.variant_id
    `;
    return rows.map((row) => ({
      ...row,
      variantId: variantIdContract.parse(row.variantId),
    }));
  }

  async readInTransaction(transaction: InventoryTransactionContext, variantId: string) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<
      Array<{ onHand: number; reserved: number; available: number; revision: number }>
    >`
      select level.on_hand as "onHand", level.revision,
        coalesce(sum(line.quantity) filter (
          where reservation.status = 'ACTIVE' and reservation.expires_at > now()
        ), 0)::int as reserved,
        (level.on_hand - coalesce(sum(line.quantity) filter (
          where reservation.status = 'ACTIVE' and reservation.expires_at > now()
        ), 0))::int as available
      from inventory_levels level
      left join inventory_reservation_lines line on line.variant_id = level.variant_id
      left join inventory_reservations reservation on reservation.id = line.reservation_id
      where level.variant_id = ${variantId}::uuid
      group by level.variant_id
    `;
    return rows[0];
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
          and reservation.status = 'ACTIVE' and reservation.expires_at > now()
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
      returning id
    `;
    return rows.length === 1;
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}
