import type { StoreId } from "@sevo/contracts/platform/v1";
import postgres, { type Sql } from "postgres";

export class PostgresVerifiedPurchaseCountReader {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 2 });
  }

  async readVerifiedPurchaseCount(storeId: StoreId) {
    const [row] = await this.#sql<Array<{ count: string; updatedAt: Date | null }>>`
      select count(*) filter (
        where orders.status = 'PAID' and fulfillment.status = 'DELIVERED'
      )::text as count,
        max(fulfillment.updated_at) as "updatedAt"
      from order_orders orders
      left join order_fulfillment_status_projections fulfillment
        on fulfillment.order_id = orders.id
      where orders.store_id = ${storeId}
    `;
    return {
      count: Number(row?.count ?? 0),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}
