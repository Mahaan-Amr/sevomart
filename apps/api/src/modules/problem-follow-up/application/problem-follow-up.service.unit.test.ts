import { describe, expect, it, vi } from "vitest";

import { ProblemFollowUpFault } from "../public";
import type { ProblemFollowUpRepository } from "../public";
import { ProblemFollowUpService } from "./problem-follow-up.service";

const buyerId = "00000000-0000-4000-8000-000000000001" as never;
const orderId = "00000000-0000-4000-8000-000000000002" as never;
const storeId = "00000000-0000-4000-8000-000000000003" as never;
const evidenceId = "00000000-0000-4000-8000-000000000004";

describe("ProblemFollowUpService", () => {
  it("opens a delivered-order dispute for its buyer inside the seven-day window", async () => {
    const open = vi.fn().mockResolvedValue({ disputeId: "saved" });
    const repository = {
      replayOpen: vi.fn().mockResolvedValue(undefined),
      open,
    } as unknown as ProblemFollowUpRepository;
    const service = new ProblemFollowUpService(
      repository,
      { readActiveIdentitySession: vi.fn().mockResolvedValue({ identityId: buyerId }) },
      {
        readOrderSnapshot: vi.fn().mockResolvedValue({
          version: 1,
          orderId,
          buyerId,
          storeId,
          status: "DELIVERED",
          shippedAt: "2026-08-20T09:00:00.000Z",
          deliveredAt: "2026-08-24T09:00:00.000Z",
        }),
      },
      () => new Date("2026-08-30T09:00:00.000Z"),
    );

    await service.open(
      { sessionToken: "buyer-session", correlationId: evidenceId },
      {
        orderId,
        category: "DAMAGED",
        description: "کالا هنگام تحویل آسیب‌دیده بود.",
        evidence: [{ evidenceId, kind: "IMAGE" }],
      },
      "open-dispute-01",
    );

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: buyerId,
        storeId,
        openedAt: new Date("2026-08-30T09:00:00.000Z"),
        sellerResponseDeadline: new Date("2026-09-01T09:00:00.000Z"),
        idempotencyKey: "open-dispute-01",
        correlationId: evidenceId,
      }),
    );
  });

  it("rejects a dispute after the shipped-order fourteen-day window", async () => {
    const service = new ProblemFollowUpService(
      {
        replayOpen: vi.fn().mockResolvedValue(undefined),
        open: vi.fn(),
      } as unknown as ProblemFollowUpRepository,
      { readActiveIdentitySession: vi.fn().mockResolvedValue({ identityId: buyerId }) },
      {
        readOrderSnapshot: vi.fn().mockResolvedValue({
          version: 1,
          orderId,
          buyerId,
          storeId,
          status: "SHIPPED",
          shippedAt: "2026-08-15T08:59:59.999Z",
        }),
      },
      () => new Date("2026-08-30T09:00:00.000Z"),
    );

    await expect(
      service.open(
        { sessionToken: "buyer-session", correlationId: evidenceId },
        {
          orderId,
          category: "DELIVERY_NOT_RECEIVED",
          description: "سفارش ارسال شده اما هنوز تحویل نشده است.",
          evidence: [{ evidenceId, kind: "IMAGE" }],
        },
        "open-dispute-02",
      ),
    ).rejects.toEqual(new ProblemFollowUpFault("WINDOW_CLOSED"));
  });

  it("replays an opened dispute before rechecking its fulfillment window", async () => {
    const replay = { disputeId: "00000000-0000-4000-8000-000000000009" };
    const readOrderSnapshot = vi.fn();
    const service = new ProblemFollowUpService(
      {
        replayOpen: vi.fn().mockResolvedValue(replay),
      } as unknown as ProblemFollowUpRepository,
      { readActiveIdentitySession: vi.fn().mockResolvedValue({ identityId: buyerId }) },
      { readOrderSnapshot },
      () => new Date("2026-09-30T09:00:00.000Z"),
    );

    await expect(
      service.open(
        { sessionToken: "buyer-session", correlationId: evidenceId },
        {
          orderId,
          category: "DAMAGED",
          description: "کالا هنگام تحویل آسیب‌دیده بود.",
          evidence: [{ evidenceId, kind: "IMAGE" }],
        },
        "open-dispute-replay",
      ),
    ).resolves.toBe(replay);
    expect(readOrderSnapshot).not.toHaveBeenCalled();
  });

  it("requires a live seller and scopes the first response to their store", async () => {
    const respond = vi.fn().mockResolvedValue({ status: "UNDER_REVIEW" });
    const service = new ProblemFollowUpService(
      { respond } as unknown as ProblemFollowUpRepository,
      { readActiveIdentitySession: vi.fn().mockResolvedValue({ identityId: buyerId }) },
      { readOrderSnapshot: vi.fn() },
      () => new Date("2026-08-30T09:00:00.000Z"),
      { isActiveSeller: vi.fn().mockResolvedValue(true) },
      { resolveStore: vi.fn().mockResolvedValue(storeId) },
    );

    await service.respond(
      { sessionToken: "seller-session", correlationId: evidenceId },
      "00000000-0000-4000-8000-000000000005",
      { response: "پاسخ فروشگاه همراه با مدرک ارسال ثبت شد.", evidence: [] },
      "respond-dispute-01",
    );

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: buyerId, storeId }),
    );
  });

  it("rejects evidence that is not ready, seller-owned and bound to the dispute", async () => {
    const respond = vi.fn();
    const service = new ProblemFollowUpService(
      { respond } as unknown as ProblemFollowUpRepository,
      { readActiveIdentitySession: vi.fn().mockResolvedValue({ identityId: buyerId }) },
      { readOrderSnapshot: vi.fn() },
      () => new Date("2026-08-30T09:00:00.000Z"),
      { isActiveSeller: vi.fn().mockResolvedValue(true) },
      { resolveStore: vi.fn().mockResolvedValue(storeId) },
      undefined,
      { isReadySellerEvidence: vi.fn().mockResolvedValue(false) },
    );

    await expect(
      service.respond(
        { sessionToken: "seller-session", correlationId: evidenceId },
        "00000000-0000-4000-8000-000000000005",
        {
          response: "پاسخ فروشگاه همراه با مدرک معتبر ثبت می‌شود.",
          evidence: [{ evidenceId, kind: "IMAGE" }],
        },
        "respond-dispute-evidence-01",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(respond).not.toHaveBeenCalled();
  });

  it("scopes idempotency hashes to the target dispute", async () => {
    const respond = vi.fn().mockResolvedValue({ status: "UNDER_REVIEW" });
    const service = new ProblemFollowUpService(
      { respond } as unknown as ProblemFollowUpRepository,
      { readActiveIdentitySession: vi.fn().mockResolvedValue({ identityId: buyerId }) },
      { readOrderSnapshot: vi.fn() },
      () => new Date("2026-08-30T09:00:00.000Z"),
      { isActiveSeller: vi.fn().mockResolvedValue(true) },
      { resolveStore: vi.fn().mockResolvedValue(storeId) },
    );
    const input = {
      response: "پاسخ فروشگاه همراه با مدرک ارسال ثبت شد.",
      evidence: [],
    };

    await service.respond(
      { sessionToken: "seller-session", correlationId: evidenceId },
      "00000000-0000-4000-8000-000000000005",
      input,
      "same-key",
    );
    await service.respond(
      { sessionToken: "seller-session", correlationId: evidenceId },
      "00000000-0000-4000-8000-000000000006",
      input,
      "same-key",
    );

    expect(respond.mock.calls[0]?.[0].requestHash).not.toBe(
      respond.mock.calls[1]?.[0].requestHash,
    );
  });

  it("requires the live platform responsibility before exposing its low-detail queue", async () => {
    const listPlatformDisputes = vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const service = new ProblemFollowUpService(
      { listPlatformDisputes } as unknown as ProblemFollowUpRepository,
      { readActiveIdentitySession: vi.fn() },
      { readOrderSnapshot: vi.fn() },
      () => new Date(),
      undefined,
      undefined,
      {
        readWorkspaceSession: vi.fn().mockResolvedValue({
          actor: { identityId: buyerId },
          permissions: ["PAYMENT_REVIEW"],
        }),
      },
    );

    await expect(
      service.listPlatformDisputes(
        { sessionToken: "platform-session", correlationId: evidenceId },
        undefined,
        undefined,
      ),
    ).rejects.toEqual(new ProblemFollowUpFault("FORBIDDEN"));
    expect(listPlatformDisputes).not.toHaveBeenCalled();
  });
});
