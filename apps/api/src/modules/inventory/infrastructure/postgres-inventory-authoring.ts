import { randomUUID } from "node:crypto";

import postgres, { type Sql } from "postgres";

import {
  InventoryRevisionConflictError,
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
    const current = rows[0] ?? { onHand: 0, revision: 0 };
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
    return updated[0]!;
  }

  async read(variantId: string): Promise<InventorySnapshot | undefined> {
    return this.readInTransaction(
      this.#sql as unknown as InventoryTransactionContext,
      variantId,
    );
  }

  async readInTransaction(transaction: InventoryTransactionContext, variantId: string) {
    const sql = transaction as unknown as Sql;
    const rows = await sql<Array<{ onHand: number; revision: number }>>`
      select on_hand as "onHand", revision from inventory_levels
      where variant_id = ${variantId}::uuid
    `;
    return rows[0];
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}
