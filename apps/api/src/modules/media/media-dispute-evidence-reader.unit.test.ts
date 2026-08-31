import { describe, expect, it, vi } from "vitest";

import type { MediaStorage } from "./public";
import { MediaDisputeEvidenceReader } from "./media-dispute-evidence-reader";

describe("seller dispute evidence reader", () => {
  it("accepts only a ready private image owned by the seller and bound to the case", async () => {
    const storage = {
      inspect: vi.fn().mockResolvedValue({
        key: "evidence-id",
        purpose: "DISPUTE_EVIDENCE",
        ownerSellerId: "seller-id",
        ownerReferenceId: "dispute-id",
        visibility: "PRIVATE",
      }),
      get: vi.fn().mockResolvedValue({ key: "evidence-id" }),
    } as unknown as MediaStorage;
    const reader = new MediaDisputeEvidenceReader(storage);

    await expect(
      reader.isReadySellerEvidence({
        identityId: "seller-id",
        disputeId: "dispute-id",
        evidenceId: "evidence-id",
        kind: "IMAGE",
      }),
    ).resolves.toBe(true);
    await expect(
      reader.isReadySellerEvidence({
        identityId: "another-seller",
        disputeId: "dispute-id",
        evidenceId: "evidence-id",
        kind: "IMAGE",
      }),
    ).resolves.toBe(false);
    await expect(
      reader.isReadySellerEvidence({
        identityId: "seller-id",
        disputeId: "dispute-id",
        evidenceId: "evidence-id",
        kind: "DOCUMENT",
      }),
    ).resolves.toBe(false);
  });
});
