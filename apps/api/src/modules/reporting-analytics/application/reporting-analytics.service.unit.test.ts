import type { IdentityId, OrderId, StoreId } from "@sevo/contracts/platform/v1";
import { describe, expect, it } from "vitest";

import type { ReportingAnalyticsRepository } from "../public";
import { ReportingAnalyticsService } from "./reporting-analytics.service";

const sellerId = "47a3f408-858c-45d7-a0bd-ab84a28718ef" as IdentityId;
const storeId = "57a3f408-858c-45d7-a0bd-ab84a28718ef" as StoreId;
const now = new Date("2026-08-31T12:00:00.000Z");

function createHarness() {
  const repository: ReportingAnalyticsRepository = {
    async readSellerOrderStates(input) {
      expect(input.storeId).toBe(storeId);
      const rows = [
        {
          orderId: "77a3f408-858c-45d7-a0bd-ab84a28718ef" as OrderId,
          totalAmount: 1_000_000,
          paidAt: "2026-08-10T08:00:00.000Z",
          fulfillmentStatus: "DELIVERED" as const,
          fulfillmentOccurredAt: "2026-08-12T08:00:00.000Z",
        },
        {
          orderId: "87a3f408-858c-45d7-a0bd-ab84a28718ef" as OrderId,
          totalAmount: 2_000_000,
          paidAt: "2026-08-20T08:00:00.000Z",
          fulfillmentStatus: "PREPARING" as const,
          fulfillmentOccurredAt: "2026-08-29T08:00:00.000Z",
        },
        {
          orderId: "97a3f408-858c-45d7-a0bd-ab84a28718ef" as OrderId,
          totalAmount: 9_000_000,
          paidAt: "2026-07-20T08:00:00.000Z",
        },
      ];
      return rows.filter(
        ({ paidAt }) =>
          (!input.from || paidAt >= input.from) && (!input.to || paidAt < input.to),
      );
    },
    async countAwaitingDisputeResponses(requestedStoreId) {
      expect(requestedStoreId).toBe(storeId);
      return 2;
    },
    async readProjectionUpdatedAt(requestedStoreId) {
      expect(requestedStoreId).toBe(storeId);
      return "2026-08-31T11:59:00.000Z";
    },
  };
  return new ReportingAnalyticsService(
    repository,
    {
      async readActiveIdentitySession() {
        return { identityId: sellerId };
      },
    },
    {
      async isActiveSeller() {
        return true;
      },
    },
    {
      async resolveStore() {
        return storeId;
      },
    },
    () => now,
  );
}

describe("ReportingAnalyticsService", () => {
  it("returns only real operational work for the authenticated seller store", async () => {
    const result = await createHarness().readOperationalSummary({
      sessionToken: "session",
    });

    expect(result).toEqual({
      storeId,
      tasks: [
        { kind: "NEW_ORDERS", count: 1, href: "/seller/orders" },
        {
          kind: "OVERDUE_PREPARATIONS",
          count: 1,
          href: "/seller/orders?status=preparing",
        },
        {
          kind: "AWAITING_DISPUTE_RESPONSES",
          count: 2,
          href: "/seller/conversations",
        },
      ],
      preparationOverdueAfterHours: 24,
      projectionUpdatedAt: "2026-08-31T11:59:00.000Z",
    });
  });

  it("reports private sales, orders and completion inside the explicit range", async () => {
    const result = await createHarness().readBasicReport(
      { sessionToken: "session" },
      { from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
    );

    expect(result).toEqual({
      storeId,
      range: {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
      },
      sales: { amount: 3_000_000, currency: "IRR" },
      orderCount: 2,
      completedOrderCount: 1,
      projectionUpdatedAt: "2026-08-31T11:59:00.000Z",
    });
  });

  it("rejects inactive sellers before reading a store report", async () => {
    const service = new ReportingAnalyticsService(
      {
        async readSellerOrderStates() {
          return [];
        },
        async countAwaitingDisputeResponses() {
          return 0;
        },
        async readProjectionUpdatedAt() {
          return null;
        },
      },
      {
        async readActiveIdentitySession() {
          return { identityId: sellerId };
        },
      },
      {
        async isActiveSeller() {
          return false;
        },
      },
      {
        async resolveStore() {
          return storeId;
        },
      },
      () => now,
    );

    await expect(
      service.readOperationalSummary({
        sessionToken: "session",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
