import type { OrderId } from "@sevo/contracts/platform/v1";
import {
  sellerBasicReportContract,
  sellerOperationalSummaryContract,
  sellerReportRangeQueryContract,
} from "@sevo/contracts/reporting-analytics/v1";

import {
  ReportingAnalyticsFault,
  type ReportingAnalyticsOrderRead,
  type ReportingAnalyticsRepository,
  type ReportingAnalyticsRequest,
  type ReportingAnalyticsSellerAccessRead,
  type ReportingAnalyticsSessionRead,
  type ReportingAnalyticsStoreResolver,
} from "../public";

const REPORTING_RANGE_DAYS = 30;
const PREPARATION_OVERDUE_AFTER_HOURS = 24;

export class ReportingAnalyticsService {
  constructor(
    private readonly repository: ReportingAnalyticsRepository,
    private readonly orders: ReportingAnalyticsOrderRead,
    private readonly sessions: ReportingAnalyticsSessionRead,
    private readonly sellerAccess: ReportingAnalyticsSellerAccessRead,
    private readonly stores: ReportingAnalyticsStoreResolver,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async readOperationalSummary(request: ReportingAnalyticsRequest) {
    const storeId = await this.requireSellerStore(request);
    const orders = await this.orders.listActionableByStore(storeId);
    const states = await this.repository.readFulfillmentStates(
      orders.map(({ orderId }) => orderId),
    );
    const stateByOrder = new Map(states.map((state) => [state.orderId, state]));
    const overdueBefore =
      this.clock().getTime() - PREPARATION_OVERDUE_AFTER_HOURS * 60 * 60 * 1_000;

    return sellerOperationalSummaryContract.parse({
      storeId,
      tasks: [
        {
          kind: "NEW_ORDERS",
          count: orders.filter(({ orderId }) => {
            const status = stateByOrder.get(orderId)?.status;
            return status === undefined || status === "ACTION_REQUIRED";
          }).length,
          href: "/seller/orders",
        },
        {
          kind: "OVERDUE_PREPARATIONS",
          count: states.filter(
            (state) =>
              state.status === "PREPARING" &&
              Date.parse(state.occurredAt) <= overdueBefore,
          ).length,
          href: "/seller/orders?status=preparing",
        },
        {
          kind: "AWAITING_DISPUTE_RESPONSES",
          count: await this.repository.countAwaitingDisputeResponses(storeId),
          href: "/seller/disputes?status=awaiting-response",
        },
      ],
      preparationOverdueAfterHours: PREPARATION_OVERDUE_AFTER_HOURS,
      projectionUpdatedAt: await this.repository.readProjectionUpdatedAt(),
    });
  }

  async readBasicReport(request: ReportingAnalyticsRequest, query: unknown) {
    const range = this.reportRange(query);
    const storeId = await this.requireSellerStore(request);
    const orders = (await this.orders.listActionableByStore(storeId)).filter(
      ({ paidAt }) => paidAt >= range.from && paidAt < range.to,
    );
    const states = await this.repository.readFulfillmentStates(
      orders.map(({ orderId }) => orderId),
    );
    const completed = new Set<OrderId>(
      states
        .filter(({ status }) => status === "DELIVERED")
        .map(({ orderId }) => orderId),
    );

    return sellerBasicReportContract.parse({
      storeId,
      range,
      sales: {
        amount: orders.reduce((total, order) => total + order.total.amount, 0),
        currency: "IRR",
      },
      orderCount: orders.length,
      completedOrderCount: orders.filter(({ orderId }) => completed.has(orderId))
        .length,
      projectionUpdatedAt: await this.repository.readProjectionUpdatedAt(),
    });
  }

  private reportRange(query: unknown) {
    const parsed = sellerReportRangeQueryContract.safeParse(query ?? {});
    if (!parsed.success) throw new ReportingAnalyticsFault("VALIDATION_ERROR");
    const to = parsed.data.to ?? this.clock().toISOString();
    const from =
      parsed.data.from ??
      new Date(
        Date.parse(to) - REPORTING_RANGE_DAYS * 24 * 60 * 60 * 1_000,
      ).toISOString();
    if (Date.parse(from) >= Date.parse(to)) {
      throw new ReportingAnalyticsFault("VALIDATION_ERROR");
    }
    return { from, to };
  }

  private async requireSellerStore(request: ReportingAnalyticsRequest) {
    if (!request.sessionToken) throw new ReportingAnalyticsFault("UNAUTHENTICATED");
    const session = await this.sessions.readActiveIdentitySession(request.sessionToken);
    if (!session) throw new ReportingAnalyticsFault("UNAUTHENTICATED");
    if (!(await this.sellerAccess.isActiveSeller(session.identityId))) {
      throw new ReportingAnalyticsFault("FORBIDDEN");
    }
    const storeId = await this.stores.resolveStore(session.identityId);
    if (!storeId) throw new ReportingAnalyticsFault("NOT_FOUND");
    return storeId;
  }
}
