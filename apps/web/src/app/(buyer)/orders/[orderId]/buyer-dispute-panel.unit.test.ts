import { fulfillmentTimelineContract } from "@sevo/contracts/fulfillment/v1";
import { describe, expect, it } from "vitest";

import { buyerDisputeAvailability } from "../../../../lib/buyer-dispute-availability";

const shipped = fulfillmentTimelineContract.parse({
  orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
  status: "SHIPPED",
  nextStatus: "DELIVERED",
  timeline: [
    {
      status: "SHIPPED",
      actor: { type: "IDENTITY", id: "57a3f408-858c-45d7-a0bd-ab84a28718ef" },
      occurredAt: "2026-08-20T09:00:00.000Z",
      correlationId: "77a3f408-858c-45d7-a0bd-ab84a28718ef",
      shipping: { method: "پست پیشتاز", trackingCode: "1234567890" },
    },
  ],
});

describe("buyer dispute availability", () => {
  it("keeps the shipped-order window open through day fourteen", () => {
    expect(
      buyerDisputeAvailability(shipped, new Date("2026-09-03T09:00:00.000Z")),
    ).toEqual({ state: "ELIGIBLE", closesAt: "2026-09-03T09:00:00.000Z" });
  });

  it("closes the shipped-order window after day fourteen", () => {
    expect(
      buyerDisputeAvailability(shipped, new Date("2026-09-03T09:00:00.001Z")),
    ).toEqual({ state: "CLOSED", closesAt: "2026-09-03T09:00:00.000Z" });
  });

  it("keeps the historical shipment anchor while a refund is pending", () => {
    const refundPending = fulfillmentTimelineContract.parse({
      ...shipped,
      status: "CANCELLATION_PENDING_REFUND",
      timeline: [
        ...shipped.timeline,
        {
          status: "CANCELLATION_PENDING_REFUND",
          actor: { type: "SYSTEM" },
          occurredAt: "2026-08-22T09:00:00.000Z",
          correlationId: "87a3f408-858c-45d7-a0bd-ab84a28718ef",
        },
      ],
    });

    expect(
      buyerDisputeAvailability(refundPending, new Date("2026-08-23T09:00:00.000Z")),
    ).toMatchObject({ state: "ELIGIBLE" });
  });
});
