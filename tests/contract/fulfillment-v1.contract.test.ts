import {
  advanceFulfillmentInputContract,
  fulfillmentAdvancedV1Contract,
  fulfillmentOrderSnapshotContract,
  fulfillmentOrderSnapshotInputContract,
  fulfillmentTimelineContract,
  fulfillmentV1Operations,
} from "@sevo/contracts/fulfillment/v1";
import { describe, expect, it } from "vitest";

const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef";
const actorId = "57a3f408-858c-45d7-a0bd-ab84a28718ef";

describe("fulfillment v1 contract", () => {
  it("publishes seller advance and shared timeline operations", () => {
    expect(fulfillmentV1Operations).toEqual({
      advanceFulfillment: {
        operationId: "advanceFulfillment",
        method: "post",
        path: "/v1/seller/orders/{orderId}/fulfillment/advance",
      },
      readSellerFulfillment: {
        operationId: "readSellerFulfillment",
        method: "get",
        path: "/v1/seller/orders/{orderId}/fulfillment",
      },
      readBuyerFulfillment: {
        operationId: "readBuyerFulfillment",
        method: "get",
        path: "/v1/orders/{orderId}/fulfillment",
      },
    });
  });

  it("requires a shipping method and keeps tracking optional", () => {
    expect(
      advanceFulfillmentInputContract.parse({
        targetStatus: "SHIPPED",
        shipping: { method: "پست پیشتاز", trackingCode: "1234567890" },
      }),
    ).toMatchObject({ targetStatus: "SHIPPED" });
    expect(() =>
      advanceFulfillmentInputContract.parse({ targetStatus: "SHIPPED" }),
    ).toThrow();
    expect(
      advanceFulfillmentInputContract.parse({
        targetStatus: "SHIPPED",
        shipping: { method: "پیک فروشگاه" },
      }),
    ).toMatchObject({ shipping: { method: "پیک فروشگاه" } });
  });

  it("returns one auditable timeline to sellers and buyers", () => {
    const timeline = fulfillmentTimelineContract.parse({
      orderId,
      status: "SHIPPED",
      nextStatus: "DELIVERED",
      timeline: [
        {
          status: "ACTION_REQUIRED",
          actor: { type: "SYSTEM" },
          occurredAt: "2026-08-30T09:00:00.000Z",
          correlationId: "67a3f408-858c-45d7-a0bd-ab84a28718ef",
        },
        {
          status: "SHIPPED",
          actor: { type: "IDENTITY", id: actorId },
          occurredAt: "2026-08-30T10:00:00.000Z",
          correlationId: "77a3f408-858c-45d7-a0bd-ab84a28718ef",
          shipping: { method: "پست پیشتاز", trackingCode: "1234567890" },
        },
      ],
    });
    expect(timeline.timeline[1]).toMatchObject({ status: "SHIPPED" });
  });

  it("keeps an order pending until refund confirmation and then cancels it", () => {
    const pending = fulfillmentTimelineContract.parse({
      orderId,
      status: "CANCELLATION_PENDING_REFUND",
      timeline: [
        {
          status: "ACTION_REQUIRED",
          actor: { type: "SYSTEM" },
          occurredAt: "2026-08-30T09:00:00.000Z",
          correlationId: "67a3f408-858c-45d7-a0bd-ab84a28718ef",
        },
        {
          status: "CANCELLATION_PENDING_REFUND",
          actor: { type: "IDENTITY", id: actorId },
          occurredAt: "2026-08-31T08:00:00.000Z",
          correlationId: "77a3f408-858c-45d7-a0bd-ab84a28718ef",
        },
      ],
    });
    expect(pending).not.toMatchObject({ status: "CANCELLED" });
    expect(
      fulfillmentTimelineContract.parse({
        ...pending,
        status: "CANCELLED",
        timeline: [
          ...pending.timeline,
          {
            status: "CANCELLED",
            actor: { type: "IDENTITY", id: actorId },
            occurredAt: "2026-08-31T08:10:00.000Z",
            correlationId: "87a3f408-858c-45d7-a0bd-ab84a28718ef",
          },
        ],
      }).status,
    ).toBe("CANCELLED");
  });

  it("publishes a PII-free FulfillmentAdvanced event", () => {
    const event = fulfillmentAdvancedV1Contract.parse({
      version: 1,
      eventId: "87a3f408-858c-45d7-a0bd-ab84a28718ef",
      eventType: "FulfillmentAdvanced.v1",
      aggregateId: orderId,
      aggregateVersion: 3,
      occurredAt: "2026-08-30T10:00:00.000Z",
      correlationId: "77a3f408-858c-45d7-a0bd-ab84a28718ef",
      causationId: "97a3f408-858c-45d7-a0bd-ab84a28718ef",
      actor: { type: "IDENTITY", id: actorId },
      payload: { fromStatus: "PREPARING", toStatus: "SHIPPED" },
    });
    expect(JSON.stringify(event)).not.toMatch(/mobile|address|tracking/i);
  });

  it("publishes the minimal authoritative snapshot for dispute eligibility", () => {
    const buyerId = "67a3f408-858c-45d7-a0bd-ab84a28718ef";
    const storeId = "77a3f408-858c-45d7-a0bd-ab84a28718ef";
    expect(fulfillmentOrderSnapshotInputContract.parse({ orderId, buyerId })).toEqual({
      orderId,
      buyerId,
    });
    expect(
      fulfillmentOrderSnapshotContract.parse({
        version: 1,
        orderId,
        buyerId,
        storeId,
        status: "DELIVERED",
        shippedAt: "2026-08-30T10:00:00.000Z",
        deliveredAt: "2026-08-30T11:00:00.000Z",
      }),
    ).toMatchObject({ version: 1, status: "DELIVERED", buyerId, storeId });
    expect(() =>
      fulfillmentOrderSnapshotContract.parse({
        version: 1,
        orderId,
        buyerId,
        storeId,
        status: "SHIPPED",
      }),
    ).toThrow();
  });
});
