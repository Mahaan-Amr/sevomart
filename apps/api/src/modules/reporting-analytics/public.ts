import type { FulfillmentStatus } from "@sevo/contracts/fulfillment/v1";
import type { IdentityId, OrderId, StoreId } from "@sevo/contracts/platform/v1";

export type ReportingAnalyticsRequest = Readonly<{
  sessionToken?: string;
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

export type ReportingSellerOrderState = Readonly<{
  orderId: OrderId;
  totalAmount: number;
  paidAt: string;
  fulfillmentStatus?: FulfillmentStatus;
  fulfillmentOccurredAt?: string;
}>;

export interface ReportingAnalyticsRepository {
  readSellerOrderStates(input: {
    storeId: StoreId;
    from?: string;
    to?: string;
  }): Promise<ReportingSellerOrderState[]>;
  countAwaitingDisputeResponses(storeId: StoreId): Promise<number>;
  readProjectionUpdatedAt(storeId: StoreId): Promise<string | null>;
}

export type ReportingAnalyticsFaultCode =
  "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR";

export class ReportingAnalyticsFault extends Error {
  constructor(readonly code: ReportingAnalyticsFaultCode) {
    super(code);
  }
}
