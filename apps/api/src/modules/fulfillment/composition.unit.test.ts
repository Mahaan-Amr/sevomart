import { describe, expect, it, vi } from "vitest";

import { createFulfillmentAuthoritativeRead } from "./composition";
import type { FulfillmentRepository } from "./public";
import type { OrderPaymentWorkflow } from "../orders/public";

const buyerId = "10000000-0000-4000-8000-000000000140" as never;
const orderId = "40000000-0000-4000-8000-000000000140" as never;
const storeId = "50000000-0000-4000-8000-000000000140" as never;

describe("createFulfillmentAuthoritativeRead", () => {
  it("does not expose a fulfillment snapshot when the order is not owned by the buyer", async () => {
    const readOrderSnapshot = vi.fn();
    const reader = createFulfillmentAuthoritativeRead(
      { readOrderSnapshot } as unknown as FulfillmentRepository,
      {
        readBuyerPaymentState: vi.fn().mockResolvedValue(undefined),
      } as unknown as OrderPaymentWorkflow,
    );

    await expect(
      reader.readOrderSnapshot({ buyerId, orderId }),
    ).resolves.toBeUndefined();
    expect(readOrderSnapshot).not.toHaveBeenCalled();
  });

  it("returns the versioned snapshot only for the paid order buyer", async () => {
    const reader = createFulfillmentAuthoritativeRead(
      {
        readOrderSnapshot: vi.fn().mockResolvedValue({
          storeId,
          status: "DELIVERED",
          shippedAt: "2026-08-20T09:00:00.000Z",
          deliveredAt: "2026-08-24T09:00:00.000Z",
        }),
      } as unknown as FulfillmentRepository,
      {
        readBuyerPaymentState: vi.fn().mockResolvedValue({ status: "PAID" }),
      } as unknown as OrderPaymentWorkflow,
    );

    await expect(reader.readOrderSnapshot({ buyerId, orderId })).resolves.toEqual({
      version: 1,
      buyerId,
      orderId,
      storeId,
      status: "DELIVERED",
      shippedAt: "2026-08-20T09:00:00.000Z",
      deliveredAt: "2026-08-24T09:00:00.000Z",
    });
  });
});
