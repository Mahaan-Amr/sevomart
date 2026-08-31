import {
  isSellerPreparationOverdue,
  sellerBasicReportContract,
  sellerOperationalSummaryContract,
  sellerPreparationOverdueAfterHours,
  sellerReportRangeQueryContract,
} from "@sevo/contracts/reporting-analytics/v1";

import {
  ReportingAnalyticsFault,
  type ReportingAnalyticsRepository,
  type ReportingAnalyticsRequest,
  type ReportingAnalyticsSellerAccessRead,
  type ReportingAnalyticsSessionRead,
  type ReportingAnalyticsStoreResolver,
} from "../public";

const REPORTING_RANGE_DAYS = 30;

export class ReportingAnalyticsService {
  constructor(
    private readonly repository: ReportingAnalyticsRepository,
    private readonly sessions: ReportingAnalyticsSessionRead,
    private readonly sellerAccess: ReportingAnalyticsSellerAccessRead,
    private readonly stores: ReportingAnalyticsStoreResolver,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async readOperationalSummary(request: ReportingAnalyticsRequest) {
    const storeId = await this.requireSellerStore(request);
    const orders = await this.repository.readSellerOrderStates({ storeId });
    const now = this.clock();

    return sellerOperationalSummaryContract.parse({
      storeId,
      tasks: [
        {
          kind: "NEW_ORDERS",
          count: orders.filter(
            ({ fulfillmentStatus }) =>
              fulfillmentStatus === undefined ||
              fulfillmentStatus === "ACTION_REQUIRED",
          ).length,
          href: "/seller/orders",
        },
        {
          kind: "OVERDUE_PREPARATIONS",
          count: orders.filter((order) => isSellerPreparationOverdue(order, now))
            .length,
          href: "/seller/orders?status=preparing",
        },
        {
          kind: "AWAITING_DISPUTE_RESPONSES",
          count: await this.repository.countAwaitingDisputeResponses(storeId),
          href: "/seller/conversations",
        },
      ],
      preparationOverdueAfterHours: sellerPreparationOverdueAfterHours,
      projectionUpdatedAt: await this.repository.readProjectionUpdatedAt(storeId),
    });
  }

  async readBasicReport(request: ReportingAnalyticsRequest, query: unknown) {
    const range = this.reportRange(query);
    const storeId = await this.requireSellerStore(request);
    const orders = await this.repository.readSellerOrderStates({
      storeId,
      ...range,
    });

    return sellerBasicReportContract.parse({
      storeId,
      range,
      sales: {
        amount: orders.reduce((total, order) => total + order.totalAmount, 0),
        currency: "IRR",
      },
      orderCount: orders.length,
      completedOrderCount: orders.filter(
        ({ fulfillmentStatus }) => fulfillmentStatus === "DELIVERED",
      ).length,
      projectionUpdatedAt: await this.repository.readProjectionUpdatedAt(storeId),
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
