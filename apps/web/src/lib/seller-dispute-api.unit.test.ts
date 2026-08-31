import { afterEach, describe, expect, it, vi } from "vitest";

import { readAllSellerDisputes } from "./seller-dispute-api";

describe("seller dispute reads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows every cursor so an older case with the nearest deadline is included", async () => {
    const newer = dispute(
      "4df3e69a-4d9c-4c5b-9bf2-75af372e18e1",
      "2026-09-03T08:30:00.000Z",
    );
    const olderButUrgent = dispute(
      "5df3e69a-4d9c-4c5b-9bf2-75af372e18e1",
      "2026-09-01T08:30:00.000Z",
    );
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ items: [newer], nextCursor: "older-page" }),
      )
      .mockResolvedValueOnce(
        Response.json({ items: [olderButUrgent], nextCursor: null }),
      );
    vi.stubGlobal("fetch", upstream);

    const result = await readAllSellerDisputes("session=cookie");

    expect(result).toEqual({ kind: "OK", data: [newer, olderButUrgent] });
    expect(upstream.mock.calls[1]?.[0]).toContain("cursor=older-page");
  });
});

function dispute(disputeId: string, dueAt: string) {
  return {
    disputeId,
    orderId: "8f6db56b-c451-4993-a243-87f667885d7c",
    storeId: "9df3e69a-4d9c-4c5b-9bf2-75af372e18e2",
    status: "AWAITING_SELLER_RESPONSE",
    category: "DAMAGED",
    openedAt: "2026-08-30T08:30:00.000Z",
    deadline: { kind: "SELLER_FIRST_RESPONSE", dueAt },
    nextAction: { actorKind: "SELLER", code: "SUBMIT_FIRST_RESPONSE" },
    contributions: [
      {
        authorKind: "BUYER",
        text: "کالا هنگام تحویل آسیب‌دیده بود.",
        evidence: [],
        submittedAt: "2026-08-30T08:30:00.000Z",
      },
    ],
    outcome: null,
  };
}
