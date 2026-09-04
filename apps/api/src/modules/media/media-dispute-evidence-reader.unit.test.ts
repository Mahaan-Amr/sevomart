import { describe, expect, it, vi } from "vitest";
import { buyerDisputeEvidenceReadInputContract } from "@sevo/contracts/media/v1";

import type { MediaStorage } from "./public";
import { MediaDisputeEvidenceReader } from "./media-dispute-evidence-reader";

describe("seller dispute evidence reader", () => {
  it("requires retrievable private buyer evidence bound to the same order context", async () => {
    const get = vi.fn().mockResolvedValue({ key: "preview" });
    const storage = {
      inspect: vi.fn().mockResolvedValue({
        key: "00000000-0000-4000-8000-000000000301",
        purpose: "BUYER_DISPUTE_EVIDENCE",
        ownerIdentityId: "00000000-0000-4000-8000-000000000101",
        ownerReferenceId: "00000000-0000-4000-8000-000000000401",
        visibility: "PRIVATE",
      }),
      readBuyerDisputeUploadContext: vi.fn().mockResolvedValue({
        identityId: "00000000-0000-4000-8000-000000000101",
        orderId: "00000000-0000-4000-8000-000000000201",
      }),
      get,
    } as unknown as MediaStorage;
    const reader = new MediaDisputeEvidenceReader(storage);
    const input = buyerDisputeEvidenceReadInputContract.parse({
      identityId: "00000000-0000-4000-8000-000000000101",
      orderId: "00000000-0000-4000-8000-000000000201",
      evidenceId: "00000000-0000-4000-8000-000000000301",
      kind: "IMAGE",
    });

    await expect(reader.isReadyBuyerEvidence(input)).resolves.toBe("READY");
    get.mockResolvedValueOnce(undefined);
    await expect(reader.isReadyBuyerEvidence(input)).resolves.toBe("NOT_READY");
    await expect(
      reader.isReadyBuyerEvidence(
        buyerDisputeEvidenceReadInputContract.parse({
          ...input,
          orderId: "00000000-0000-4000-8000-000000000202",
        }),
      ),
    ).resolves.toBe("NOT_READY");
  });

  it("accepts only a ready private image owned by the seller and bound to the case", async () => {
    const storage = {
      inspect: vi.fn().mockResolvedValue({
        key: "evidence-id",
        purpose: "DISPUTE_EVIDENCE",
        ownerIdentityId: "seller-id",
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
