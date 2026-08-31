import { randomUUID } from "node:crypto";

import type { StoredOutboxEvent } from "@sevo/outbox";
import type { JSONValue, Sql } from "postgres";
import { describe, expect, it } from "vitest";

import {
  projectDisputeState,
  projectFulfillmentState,
  projectSellerOrderFact,
} from "./index";

function captureSql() {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return [];
  }) as unknown as Sql;
  return { calls, sql };
}

function envelope(
  eventType: string,
  aggregateVersion: number,
  payload: JSONValue,
): StoredOutboxEvent {
  return {
    version: 1 as const,
    eventId: randomUUID(),
    eventType,
    aggregateId: randomUUID(),
    aggregateVersion,
    occurredAt: "2026-08-31T10:00:00.000Z",
    correlationId: randomUUID(),
    causationId: randomUUID(),
    actor: { type: "SYSTEM" as const },
    payload,
  };
}

describe("seller reporting projections", () => {
  it("projects private order facts with their seller store routing key", async () => {
    const { calls, sql } = captureSql();
    const storeId = randomUUID();
    const event = envelope("OrderReportingSnapshot.v1", 2, {
      storeId,
      status: "PAID",
      total: { amount: 1_200_000, currency: "IRR" },
      paidAt: "2026-08-31T10:00:00.000Z",
    });

    await projectSellerOrderFact(event, sql);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain("insert into reporting_seller_order_facts");
    expect(calls[0]!.text).not.toMatch(/order_orders/);
    expect(calls[0]!.values).toEqual(
      expect.arrayContaining([event.aggregateId, storeId, 1_200_000]),
    );
  });

  it("projects the latest fulfillment state without reading fulfillment tables", async () => {
    const { calls, sql } = captureSql();
    const event = envelope("FulfillmentAdvanced.v1", 3, {
      fromStatus: "PREPARING",
      toStatus: "SHIPPED",
    });

    await projectFulfillmentState(event, sql);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain("insert into reporting_fulfillment_states");
    expect(calls[0]!.text).not.toMatch(/fulfillment_orders|order_orders/);
    expect(calls[0]!.values).toEqual(
      expect.arrayContaining([
        event.aggregateId,
        "SHIPPED",
        event.aggregateVersion,
        event.eventId,
      ]),
    );
  });

  it("keeps the store routing key when a dispute starts awaiting seller response", async () => {
    const { calls, sql } = captureSql();
    const storeId = randomUUID();
    const disputeId = randomUUID();
    const event = envelope("DisputeOpened.v1", 1, {
      disputeId,
      orderId: randomUUID(),
      storeId,
      category: "DAMAGED",
      status: "AWAITING_SELLER_RESPONSE",
      deadlineAt: "2026-09-02T10:00:00.000Z",
    });

    await projectDisputeState(event, sql);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain("insert into reporting_seller_dispute_states");
    expect(calls[0]!.values).toEqual(expect.arrayContaining([disputeId, storeId]));
  });

  it("removes a responded dispute from seller response work without cross-module reads", async () => {
    const { calls, sql } = captureSql();
    const disputeId = randomUUID();
    const event = {
      ...envelope("DisputeResponded.v1", 2, {
        disputeId,
        fromStatus: "AWAITING_SELLER_RESPONSE",
        toStatus: "UNDER_REVIEW",
        nextDeadlineAt: null,
        reasonCode: "SELLER_SUBMITTED_RESPONSE",
      }),
      aggregateId: disputeId,
    };

    await projectDisputeState(event, sql);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain("update reporting_seller_dispute_states");
    expect(calls[0]!.text).not.toMatch(/problem_follow_up|order_orders/);
    expect(calls[0]!.values).toEqual(
      expect.arrayContaining([disputeId, "UNDER_REVIEW", event.aggregateVersion]),
    );
  });
});
