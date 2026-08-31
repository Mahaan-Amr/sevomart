import { randomUUID } from "node:crypto";

import { fulfillmentAdvancedV1Contract } from "@sevo/contracts/fulfillment/v1";
import { disputeOpenedV1Contract } from "@sevo/contracts/problem-follow-up/v1";
import { orderIdContract, storeIdContract } from "@sevo/contracts/platform/v1";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PostgresReportingAnalyticsRepository } from "../../apps/api/src/modules/reporting-analytics/composition";
import {
  projectDisputeState,
  projectFulfillmentState,
} from "../../apps/worker/src/modules/reporting-analytics/index";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("seller reporting projection", () => {
  const repositories: PostgresReportingAnalyticsRepository[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from reporting_seller_dispute_states`;
    await sql`delete from reporting_fulfillment_states`;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(
      repositories.splice(0).map((repository) => repository.onModuleDestroy()),
    );
  });

  it("reads fulfillment states only for requested seller order ids", async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const requestedOrderId = orderIdContract.parse(randomUUID());
    const otherOrderId = orderIdContract.parse(randomUUID());
    for (const orderId of [requestedOrderId, otherOrderId]) {
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
    await sql.end();

    const repository = new PostgresReportingAnalyticsRepository(
      apiTestEnvironment.DATABASE_URL,
    );
    repositories.push(repository);
    await expect(repository.readFulfillmentStates([requestedOrderId])).resolves.toEqual(
      [
        {
          orderId: requestedOrderId,
          status: "PREPARING",
          occurredAt: "2026-08-30T08:00:00.000Z",
        },
      ],
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
});
