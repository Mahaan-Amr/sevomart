import { describe, expect, it, vi } from "vitest";

import {
  BuyerDisputeClientError,
  issueBuyerDisputeMediaContext,
  prepareOpenBuyerDispute,
} from "./buyer-dispute-client";

const orderId = "00000000-0000-4000-8000-000000000005";
const evidenceId = "00000000-0000-4000-8000-000000000007";

describe("buyer dispute client", () => {
  it("requests an opaque context without putting evidence in the request", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json(
        {
          contextId: "71000000-0000-4000-8000-000000000001",
          expiresAt: "2026-08-31T09:30:00.000Z",
          maxItems: 10,
          maxBytesPerItem: 10 * 1024 * 1024,
          uploadUrl: "/v1/buyer-dispute-media/71000000-0000-4000-8000-000000000001",
        },
        { status: 201 },
      ),
    );

    await issueBuyerDisputeMediaContext(orderId, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/buyer/dispute-media-contexts",
      expect.objectContaining({ body: JSON.stringify({ orderId }) }),
    );
  });

  it("keeps one idempotency key for a safe open retry", async () => {
    const opened = {
      disputeId: "00000000-0000-4000-8000-000000000011",
      orderId,
      storeId: "00000000-0000-4000-8000-000000000006",
      status: "AWAITING_SELLER_RESPONSE",
      category: "DAMAGED",
      openedAt: "2026-08-31T09:00:00.000Z",
      deadline: {
        kind: "SELLER_FIRST_RESPONSE",
        dueAt: "2026-09-02T09:00:00.000Z",
      },
      nextAction: { actorKind: "SELLER", code: "SUBMIT_FIRST_RESPONSE" },
      contributions: [
        {
          authorKind: "BUYER",
          text: "کالا هنگام تحویل آسیب‌دیده بود.",
          evidence: [
            { evidenceId, kind: "IMAGE", submittedAt: "2026-08-31T09:00:00.000Z" },
          ],
          submittedAt: "2026-08-31T09:00:00.000Z",
        },
      ],
      outcome: null,
    };
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(Response.json(opened, { status: 201 })),
      );
    const operation = prepareOpenBuyerDispute({
      idempotencyKey: "stable-open-key",
      fetcher,
      body: {
        orderId,
        category: "DAMAGED",
        description: "کالا هنگام تحویل آسیب‌دیده بود.",
        evidence: [{ evidenceId, kind: "IMAGE" }],
      },
    });

    await operation.run();
    await operation.run();

    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, request] of fetcher.mock.calls) {
      expect((request as RequestInit).headers).toMatchObject({
        "idempotency-key": "stable-open-key",
      });
    }
  });

  it("turns a closed window into a clear Persian next step", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { code: "WINDOW_CLOSED", correlationId: "request-id", message: "" },
          { status: 409 },
        ),
      );

    await expect(issueBuyerDisputeMediaContext(orderId, fetcher)).rejects.toEqual(
      new BuyerDisputeClientError(
        "WINDOW_CLOSED",
        "مهلت ثبت اختلاف برای این سفارش گذشته است.",
      ),
    );
  });
});
