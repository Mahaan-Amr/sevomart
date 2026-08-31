import type { FulfillmentStatus } from "@sevo/contracts/fulfillment/v1";
import type { SellerActionableOrder } from "@sevo/contracts/orders/v1";
import type { IdentityId, OrderId, StoreId } from "@sevo/contracts/platform/v1";

export type ReportingAnalyticsRequest = Readonly<{
  sessionToken?: string;
  correlationId: string;
}>;

export interface ReportingAnalyticsSessionRead {
  readActiveIdentitySession(
    token: string,
  ): Promise<{ identityId: IdentityId } | undefined>;
}

export interface ReportingAnalyticsSellerAccessRead {
  isActiveSeller(identityId: IdentityId): Promise<boolean>;
}

export interface ReportingAnalyticsStoreResolver {
  resolveStore(identityId: IdentityId): Promise<StoreId | undefined>;
}

export interface ReportingAnalyticsOrderRead {
  listActionableByStore(storeId: StoreId): Promise<SellerActionableOrder[]>;
}

export type ReportingFulfillmentState = Readonly<{
  orderId: OrderId;
  status: FulfillmentStatus;
  occurredAt: string;
}>;

export interface ReportingAnalyticsRepository {
  readFulfillmentStates(
    orderIds: readonly OrderId[],
  ): Promise<ReportingFulfillmentState[]>;
  countAwaitingDisputeResponses(storeId: StoreId): Promise<number>;
  readProjectionUpdatedAt(): Promise<string | null>;
}

export type ReportingAnalyticsFaultCode =
  "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR";

export class ReportingAnalyticsFault extends Error {
  constructor(readonly code: ReportingAnalyticsFaultCode) {
    super(code);
  }
}
