import postgres, { type Sql } from "postgres";

import {
  InventoryRevisionConflictError,
  type InventoryAuthoring,
  type InventorySnapshot,
} from "../public";

export class PostgresInventoryAuthoring implements InventoryAuthoring {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 3 });
  }

  async replaceForProduct(
    sql: Sql,
    command: {
      storeId: string;
      variantId: string;
      onHand: number;
      expectedRevision: number;
    },
  ): Promise<InventorySnapshot> {
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
    return updated[0]!;
  }

  async read(variantId: string): Promise<InventorySnapshot | undefined> {
    return this.readInTransaction(this.#sql, variantId);
  }

  async readInTransaction(sql: Sql, variantId: string) {
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
