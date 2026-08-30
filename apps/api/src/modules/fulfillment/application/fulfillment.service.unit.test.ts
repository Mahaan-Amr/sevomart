import type {
  FulfillmentTimeline,
  FulfillmentTimelineEntry,
} from "@sevo/contracts/fulfillment/v1";
import type { IdentityId, OrderId, StoreId } from "@sevo/contracts/platform/v1";
import { describe, expect, it } from "vitest";

import {
  FulfillmentFault,
  type FulfillmentOrderAccess,
  type FulfillmentRepository,
} from "../public";
import { FulfillmentService } from "./fulfillment.service";

const sellerId = "57a3f408-858c-45d7-a0bd-ab84a28718ef" as IdentityId;
const buyerId = "67a3f408-858c-45d7-a0bd-ab84a28718ef" as IdentityId;
const storeId = "77a3f408-858c-45d7-a0bd-ab84a28718ef" as StoreId;
const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef" as OrderId;
const correlationId = "87a3f408-858c-45d7-a0bd-ab84a28718ef";

function createHarness(status: FulfillmentTimeline["status"] = "ACTION_REQUIRED") {
  let timeline: FulfillmentTimeline = {
    orderId,
    status,
    nextStatus:
      status === "ACTION_REQUIRED"
        ? "PREPARING"
        : status === "PREPARING"
          ? "SHIPPED"
          : status === "SHIPPED"
            ? "DELIVERED"
            : undefined,
    timeline: [
      {
        status,
        actor: { type: "SYSTEM" },
        occurredAt: "2026-08-30T09:00:00.000Z",
        correlationId,
      },
    ],
  };
  const repository: FulfillmentRepository = {
    async read(requestedOrderId) {
      return requestedOrderId === orderId ? timeline : undefined;
    },
    async replayAdvance() {
      return undefined;
    },
    async readOrderSnapshot(requestedOrderId) {
      if (requestedOrderId !== orderId || status === "ACTION_REQUIRED")
        return undefined;
      return {
        storeId,
        status: status === "DELIVERED" ? "DELIVERED" : "SHIPPED",
        shippedAt: "2026-08-30T09:00:00.000Z",
        ...(status === "DELIVERED" ? { deliveredAt: "2026-08-30T10:00:00.000Z" } : {}),
      };
    },
    async advance(command) {
      const entry: FulfillmentTimelineEntry = {
        status: command.input.targetStatus,
        actor: { type: "IDENTITY", id: command.actorId },
        occurredAt: command.occurredAt.toISOString(),
        correlationId: command.correlationId,
        ...(command.input.targetStatus === "SHIPPED"
          ? { shipping: command.input.shipping }
          : {}),
      };
      timeline = {
        orderId,
        status: command.input.targetStatus,
        nextStatus:
          command.input.targetStatus === "PREPARING"
            ? "SHIPPED"
            : command.input.targetStatus === "SHIPPED"
              ? "DELIVERED"
              : undefined,
        timeline: [...timeline.timeline, entry],
      };
      return timeline;
    },
  };
  const orders: FulfillmentOrderAccess = {
    async sellerCanFulfill(actorId, requestedStoreId, requestedOrderId) {
      return (
        actorId === sellerId &&
        requestedStoreId === storeId &&
        requestedOrderId === orderId
      );
    },
    async buyerCanTrack(actorId, requestedOrderId) {
      return actorId === buyerId && requestedOrderId === orderId;
    },
  };
  const service = new FulfillmentService(
    repository,
    {
      async readActiveIdentitySession(token) {
        return token === "seller"
          ? { identityId: sellerId }
          : token === "buyer"
            ? { identityId: buyerId }
            : undefined;
      },
    },
    {
      async isActiveSeller(identityId) {
        return identityId === sellerId;
      },
    },
    {
      async resolveStore(identityId) {
        return identityId === sellerId ? storeId : undefined;
      },
    },
    orders,
    () => new Date("2026-08-30T10:00:00.000Z"),
  );
  return { service, read: () => timeline };
}

describe("FulfillmentService", () => {
  it("allows only the next transition and records actor, time and correlation", async () => {
    const { service, read } = createHarness();
    await expect(
      service.advance(
        { sessionToken: "seller", correlationId },
        orderId,
        { targetStatus: "SHIPPED", shipping: { method: "پست" } },
        "advance-01",
      ),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    await service.advance(
      { sessionToken: "seller", correlationId },
      orderId,
      { targetStatus: "PREPARING" },
      "advance-02",
    );
    expect(read().timeline.at(-1)).toMatchObject({
      status: "PREPARING",
      actor: { type: "IDENTITY", id: sellerId },
      occurredAt: "2026-08-30T10:00:00.000Z",
      correlationId,
    });
  });

  it("shows the exact same timeline through seller and buyer reads", async () => {
    const { service } = createHarness("SHIPPED");
    const sellerView = await service.readSeller(
      { sessionToken: "seller", correlationId },
      orderId,
    );
    const buyerView = await service.readBuyer(
      { sessionToken: "buyer", correlationId },
      orderId,
    );
    expect(buyerView).toEqual(sellerView);
  });

  it("does not expose another store or buyer order", async () => {
    const { service } = createHarness();
    await expect(
      service.readSeller({ sessionToken: "buyer", correlationId }, orderId),
    ).rejects.toBeInstanceOf(FulfillmentFault);
    await expect(
      service.readBuyer({ sessionToken: "seller", correlationId }, orderId),
    ).rejects.toMatchObject({ code: "FULFILLMENT_NOT_FOUND" });
  });

  it("returns a versioned authoritative snapshot only for the order buyer", async () => {
    const { service } = createHarness("DELIVERED");
    await expect(service.readOrderSnapshot({ orderId, buyerId })).resolves.toEqual({
      version: 1,
      orderId,
      buyerId,
      storeId,
      status: "DELIVERED",
      shippedAt: "2026-08-30T09:00:00.000Z",
      deliveredAt: "2026-08-30T10:00:00.000Z",
    });
    await expect(
      service.readOrderSnapshot({ orderId, buyerId: sellerId }),
    ).resolves.toBe(undefined);
  });
});
