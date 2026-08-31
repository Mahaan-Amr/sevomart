import { randomUUID } from "node:crypto";

import { fulfillmentAdvancedV1Contract } from "@sevo/contracts/fulfillment/v1";
import { orderReportingSnapshotV1Contract } from "@sevo/contracts/orders/v1";
import { disputeOpenedV1Contract } from "@sevo/contracts/problem-follow-up/v1";
import { orderIdContract, storeIdContract } from "@sevo/contracts/platform/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PostgresReportingAnalyticsRepository } from "../../apps/api/src/modules/reporting-analytics/composition";
import { createApiApp } from "../../apps/api/src/create-app";
import { createActiveSellerFixture } from "../../apps/api/src/modules/identity-access/testing/active-seller.fixture";
import { createOwnedSellableStoreFixture } from "../../apps/api/src/modules/store/testing/owned-sellable-store.fixture";
import {
  projectDisputeState,
  projectFulfillmentState,
  projectSellerOrderFact,
} from "../../apps/worker/src/modules/reporting-analytics/index";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const reportingSellerMobile = "09120000137";
const reportingSellerEnvironment = {
  ...apiTestEnvironment,
  DEV_OTP_TEST_MOBILES: [
    reportingSellerMobile,
  ] as typeof apiTestEnvironment.DEV_OTP_TEST_MOBILES,
};

describe("seller reporting projection", () => {
  const repositories: PostgresReportingAnalyticsRepository[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from reporting_seller_dispute_states`;
    await sql`delete from reporting_seller_order_facts`;
    await sql`delete from reporting_fulfillment_states`;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(
      repositories.splice(0).map((repository) => repository.onModuleDestroy()),
    );
  });

  it("reads order and fulfillment facts only for the requested seller store", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const requestedOrderId = orderIdContract.parse(randomUUID());
    const otherOrderId = orderIdContract.parse(randomUUID());
    const requestedStoreId = storeIdContract.parse(randomUUID());
    const otherStoreId = storeIdContract.parse(randomUUID());
    for (const [orderId, storeId] of [
      [requestedOrderId, requestedStoreId],
      [otherOrderId, otherStoreId],
    ] as const) {
      await projectSellerOrderFact(
        orderReportingSnapshotV1Contract.parse({
          version: 1,
          eventId: randomUUID(),
          eventType: "OrderReportingSnapshot.v1",
          aggregateId: orderId,
          aggregateVersion: 2,
          occurredAt: "2026-08-30T07:00:00.000Z",
          correlationId: randomUUID(),
          causationId: randomUUID(),
          actor: { type: "SYSTEM" },
          payload: {
            storeId,
            status: "PAID",
            total: { amount: 3_000_000_000, currency: "IRR" },
            paidAt: "2026-08-30T07:00:00.000Z",
          },
        }),
        sql,
      );
      await projectFulfillmentState(
        fulfillmentAdvancedV1Contract.parse({
          version: 1,
          eventId: randomUUID(),
          eventType: "FulfillmentAdvanced.v1",
          aggregateId: orderId,
          aggregateVersion: 2,
          occurredAt: "2026-08-30T08:00:00.000Z",
          correlationId: randomUUID(),
          causationId: randomUUID(),
          actor: { type: "IDENTITY", id: randomUUID() },
          payload: { fromStatus: "ACTION_REQUIRED", toStatus: "PREPARING" },
        }),
        sql,
      );
    }
    await sql`
      update reporting_seller_order_facts
      set projected_at = case
        when store_id = ${requestedStoreId} then '2026-08-30T09:00:00.000Z'::timestamptz
        else '2027-01-01T00:00:00.000Z'::timestamptz
      end
    `;
    await sql`
      update reporting_fulfillment_states
      set projected_at = '2026-08-30T09:00:00.000Z'::timestamptz
      where order_id = ${requestedOrderId}
    `;
    await sql.end();

    const repository = new PostgresReportingAnalyticsRepository(
      apiTestEnvironment.DATABASE_URL,
    );
    repositories.push(repository);
    await expect(
      repository.readSellerOrderStates({ storeId: requestedStoreId }),
    ).resolves.toEqual([
      {
        orderId: requestedOrderId,
        totalAmount: 3_000_000_000,
        paidAt: "2026-08-30T07:00:00.000Z",
        fulfillmentStatus: "PREPARING",
        fulfillmentOccurredAt: "2026-08-30T08:00:00.000Z",
      },
    ]);
    await expect(repository.readProjectionUpdatedAt(requestedStoreId)).resolves.toBe(
      "2026-08-30T09:00:00.000Z",
    );
  });

  it("counts only disputes awaiting a response for the requested store", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const requestedStoreId = storeIdContract.parse(randomUUID());
    const otherStoreId = storeIdContract.parse(randomUUID());
    for (const storeId of [requestedStoreId, otherStoreId]) {
      const disputeId = randomUUID();
      await projectDisputeState(
        disputeOpenedV1Contract.parse({
          version: 1,
          eventId: randomUUID(),
          eventType: "DisputeOpened.v1",
          aggregateId: disputeId,
          aggregateVersion: 1,
          occurredAt: "2026-08-30T08:00:00.000Z",
          correlationId: randomUUID(),
          actor: { type: "IDENTITY", id: randomUUID() },
          payload: {
            disputeId,
            orderId: randomUUID(),
            storeId,
            category: "DAMAGED",
            status: "AWAITING_SELLER_RESPONSE",
            deadlineAt: "2026-09-01T08:00:00.000Z",
          },
        }),
        sql,
      );
    }
    await sql.end();

    const repository = new PostgresReportingAnalyticsRepository(
      apiTestEnvironment.DATABASE_URL,
    );
    repositories.push(repository);
    await expect(
      repository.countAwaitingDisputeResponses(requestedStoreId),
    ).resolves.toBe(1);
  });

  it("serves only the authenticated seller store through the composed HTTP API", async () => {
    const app = await createApiApp(reportingSellerEnvironment);
    const server = app.getHttpAdapter().getInstance();
    let activeSeller: Awaited<ReturnType<typeof createActiveSellerFixture>> | undefined;
    let ownedStore:
      Awaited<ReturnType<typeof createOwnedSellableStoreFixture>> | undefined;
    try {
      const requested = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/requests",
        payload: { mobile: reportingSellerMobile },
      });
      const verified = await server.inject({
        method: "POST",
        url: "/v1/auth/otp/verifications",
        payload: { challengeId: requested.json().challengeId, code: "111111" },
      });
      const cookie = verified.headers["set-cookie"]!;
      const session = await server.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie },
      });
      const sellerId = identityIdContract.parse(session.json().actor.identityId);
      const storeId = storeIdContract.parse(randomUUID());
      const otherStoreId = storeIdContract.parse(randomUUID());
      activeSeller = await createActiveSellerFixture(
        apiTestEnvironment.DATABASE_URL,
        sellerId,
      );
      ownedStore = await createOwnedSellableStoreFixture(
        apiTestEnvironment.DATABASE_URL,
        { sellerId, storeId },
      );

      const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
      for (const projectedStoreId of [storeId, otherStoreId]) {
        await projectSellerOrderFact(
          orderReportingSnapshotV1Contract.parse({
            version: 1,
            eventId: randomUUID(),
            eventType: "OrderReportingSnapshot.v1",
            aggregateId: randomUUID(),
            aggregateVersion: 2,
            occurredAt: "2026-08-30T07:00:00.000Z",
            correlationId: randomUUID(),
            causationId: randomUUID(),
            actor: { type: "SYSTEM" },
            payload: {
              storeId: projectedStoreId,
              status: "PAID",
              total: { amount: 1_000_000, currency: "IRR" },
              paidAt: "2026-08-30T07:00:00.000Z",
            },
          }),
          sql,
        );
      }
      await sql.end();

      const overview = await server.inject({
        method: "GET",
        url: "/v1/seller/overview",
        headers: { cookie },
      });
      expect(overview.statusCode).toBe(200);
      expect(overview.headers["cache-control"]).toBe("private, no-store");
      const overviewBody = overview.json<{
        storeId: string;
        tasks: Array<{ kind: string; count: number }>;
      }>();
      expect(overviewBody.storeId).toBe(storeId);
      expect(
        overviewBody.tasks.find(({ kind }) => kind === "NEW_ORDERS"),
      ).toMatchObject({ count: 1 });

      const report = await server.inject({
        method: "GET",
        url: "/v1/seller/reports?from=2026-08-01T00:00:00.000Z&to=2026-09-01T00:00:00.000Z",
        headers: { cookie },
      });
      expect(report.statusCode).toBe(200);
      expect(report.json()).toMatchObject({
        storeId,
        sales: { amount: 1_000_000, currency: "IRR" },
        orderCount: 1,
      });

      const unauthenticated = await server.inject({
        method: "GET",
        url: "/v1/seller/reports",
      });
      expect(unauthenticated.statusCode).toBe(401);
      expect(unauthenticated.json()).toMatchObject({
        version: 1,
        code: "UNAUTHENTICATED",
      });
    } finally {
      await ownedStore?.cleanup();
      await activeSeller?.cleanup();
      await app.close();
    }
  });
});
