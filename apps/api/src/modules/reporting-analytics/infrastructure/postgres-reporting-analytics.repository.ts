import { fulfillmentStatusContract } from "@sevo/contracts/fulfillment/v1";
import { orderIdContract } from "@sevo/contracts/platform/v1";
import postgres from "postgres";

import type { ReportingAnalyticsRepository } from "../public";

export class PostgresReportingAnalyticsRepository implements ReportingAnalyticsRepository {
  readonly #sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async readFulfillmentStates(
    orderIds: Parameters<ReportingAnalyticsRepository["readFulfillmentStates"]>[0],
  ) {
    if (orderIds.length === 0) return [];
    const rows = await this.#sql<
      Array<{ orderId: string; status: string; occurredAt: Date }>
    >`
      select order_id as "orderId", status, occurred_at as "occurredAt"
      from reporting_fulfillment_states
      where order_id in ${this.#sql(orderIds)}
    `;
    return rows.map((row) => ({
      orderId: orderIdContract.parse(row.orderId),
      status: fulfillmentStatusContract.parse(row.status),
      occurredAt: row.occurredAt.toISOString(),
    }));
  }

  async countAwaitingDisputeResponses(
    storeId: Parameters<
      ReportingAnalyticsRepository["countAwaitingDisputeResponses"]
    >[0],
  ) {
    const rows = await this.#sql<Array<{ count: number }>>`
      select count(*)::int as count
      from reporting_seller_dispute_states
      where store_id = ${storeId}
        and status = 'AWAITING_SELLER_RESPONSE'
    `;
    return rows[0]?.count ?? 0;
  }

  async readProjectionUpdatedAt() {
    const rows = await this.#sql<Array<{ updatedAt: Date | null }>>`
      select greatest(
        (select max(projected_at) from reporting_fulfillment_states),
        (select max(projected_at) from reporting_seller_dispute_states)
      ) as "updatedAt"
    `;
    return rows[0]?.updatedAt?.toISOString() ?? null;
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}
