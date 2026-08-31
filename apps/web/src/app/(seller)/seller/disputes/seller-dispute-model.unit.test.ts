import { describe, expect, it } from "vitest";
import { sellerDisputeViewContract } from "@sevo/contracts/problem-follow-up/v1";

import {
  formatOrderReference,
  nearestSellerResponseDispute,
  responseRecoveryMessage,
  sellerNeedsToRespond,
} from "./seller-dispute-model";

const baseDispute = sellerDisputeViewContract.parse({
  disputeId: "4df3e69a-4d9c-4c5b-9bf2-75af372e18e1",
  orderId: "8f6db56b-c451-4993-a243-87f667885d7c",
  storeId: "9df3e69a-4d9c-4c5b-9bf2-75af372e18e2",
  status: "AWAITING_SELLER_RESPONSE",
  category: "DAMAGED",
  openedAt: "2026-08-30T08:30:00.000Z",
  deadline: {
    kind: "SELLER_FIRST_RESPONSE",
    dueAt: "2026-09-01T08:30:00.000Z",
  },
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
});

describe("seller dispute presentation", () => {
  it("chooses the nearest dispute that actually needs the seller", () => {
    const later = sellerDisputeViewContract.parse({
      ...baseDispute,
      disputeId: "5df3e69a-4d9c-4c5b-9bf2-75af372e18e1",
      deadline: { ...baseDispute.deadline, dueAt: "2026-09-02T08:30:00.000Z" },
    });
    const waiting = sellerDisputeViewContract.parse({
      ...baseDispute,
      disputeId: "6df3e69a-4d9c-4c5b-9bf2-75af372e18e1",
      status: "UNDER_REVIEW",
      nextAction: { actorKind: null, code: "WAIT_FOR_PLATFORM" },
    });

    expect(nearestSellerResponseDispute([later, waiting, baseDispute])?.disputeId).toBe(
      baseDispute.disputeId,
    );
  });

  it("shares one response-action predicate and presents a short order reference", () => {
    expect(sellerNeedsToRespond(baseDispute)).toBe(true);
    expect(formatOrderReference(baseDispute.orderId)).toBe("۸۸۵D۷C");
  });

  it("gives a human recovery step for stale, duplicate and inaccessible cases", () => {
    expect(responseRecoveryMessage("DEADLINE_PASSED")).toContain("بررسی سوو");
    expect(responseRecoveryMessage("IDEMPOTENCY_CONFLICT")).toContain("تازه");
    expect(responseRecoveryMessage("NOT_FOUND")).toContain("در دسترس");
  });
});
