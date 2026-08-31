import { fulfillmentTimelineContract } from "@sevo/contracts/fulfillment/v1";
import { describe, expect, it } from "vitest";

import { isOverdueSellerPreparation } from "./seller-order-actionability";

const now = new Date("2026-08-31T12:00:00.000Z");

describe("seller order actionability", () => {
  it("includes only a preparation at or beyond the producer threshold", () => {
    expect(
      isOverdueSellerPreparation(timeline("2026-08-30T12:00:00.000Z"), now, 24),
    ).toBe(true);
    expect(
      isOverdueSellerPreparation(timeline("2026-08-31T10:00:00.000Z"), now, 24),
    ).toBe(false);
  });
});

function timeline(occurredAt: string) {
  return fulfillmentTimelineContract.parse({
    orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    status: "PREPARING" as const,
    nextStatus: "SHIPPED" as const,
    timeline: [
      {
        status: "PREPARING" as const,
        actor: { type: "SYSTEM" as const },
        occurredAt,
        correlationId: "67a3f408-858c-45d7-a0bd-ab84a28718ef",
      },
    ],
  });
}
