import { fulfillmentStatusContract } from "@sevo/contracts/fulfillment/v1";
import { orderIdContract } from "@sevo/contracts/platform/v1";
import postgres from "postgres";

import type { ReportingAnalyticsRepository } from "../public";

export class PostgresReportingAnalyticsRepository implements ReportingAnalyticsRepository {
  readonly #sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async readSellerOrderStates(
    input: Parameters<ReportingAnalyticsRepository["readSellerOrderStates"]>[0],
  ) {
    const rows = await this.#sql<
      Array<{
        orderId: string;
        totalAmount: string;
        paidAt: Date;
        fulfillmentStatus: string | null;
        fulfillmentOccurredAt: Date | null;
      }>
    >`
      select facts.order_id as "orderId", facts.total_amount::text as "totalAmount",
        facts.paid_at as "paidAt", fulfillment.status as "fulfillmentStatus",
        fulfillment.occurred_at as "fulfillmentOccurredAt"
      from reporting_seller_order_facts facts
      left join reporting_fulfillment_states fulfillment
        on fulfillment.order_id = facts.order_id
      where facts.store_id = ${input.storeId}
        and (${input.from ?? null}::timestamptz is null
          or facts.paid_at >= ${input.from ?? null}::timestamptz)
        and (${input.to ?? null}::timestamptz is null
          or facts.paid_at < ${input.to ?? null}::timestamptz)
    `;
    return rows.map((row) => {
      const fulfillmentStatus = row.fulfillmentStatus
        ? fulfillmentStatusContract.parse(row.fulfillmentStatus)
        : undefined;
      return {
        orderId: orderIdContract.parse(row.orderId),
        totalAmount: Number(row.totalAmount),
        paidAt: row.paidAt.toISOString(),
        ...(fulfillmentStatus ? { fulfillmentStatus } : {}),
        ...(row.fulfillmentOccurredAt
          ? { fulfillmentOccurredAt: row.fulfillmentOccurredAt.toISOString() }
          : {}),
      };
    });
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

  async readProjectionUpdatedAt(
    storeId: Parameters<ReportingAnalyticsRepository["readProjectionUpdatedAt"]>[0],
  ) {
    const rows = await this.#sql<Array<{ updatedAt: Date | null }>>`
      select greatest(
        (select max(facts.projected_at)
         from reporting_seller_order_facts facts
         where facts.store_id = ${storeId}),
        (select max(fulfillment.projected_at)
         from reporting_fulfillment_states fulfillment
         join reporting_seller_order_facts facts
           on facts.order_id = fulfillment.order_id
         where facts.store_id = ${storeId}),
        (select max(disputes.projected_at)
         from reporting_seller_dispute_states disputes
         where disputes.store_id = ${storeId})
      ) as "updatedAt"
    `;
    return rows[0]?.updatedAt?.toISOString() ?? null;
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}
