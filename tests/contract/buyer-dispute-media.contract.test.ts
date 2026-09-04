import {
  BUYER_DISPUTE_MEDIA_MAX_ITEMS,
  buyerDisputeEvidenceReadInputContract,
  buyerDisputeEvidenceReadResultContract,
  buyerDisputeMediaContextContract,
  buyerDisputeMediaContextIdContract,
  buyerDisputeMediaUploadInputContract,
  buyerDisputeMediaUploadPurpose,
  mediaUploadInputContract,
} from "@sevo/contracts/media/v1";
import { expect, it } from "vitest";

it("publishes a private buyer dispute evidence contract without reusing seller purposes", () => {
  expect(buyerDisputeMediaUploadPurpose).toBe("BUYER_DISPUTE_EVIDENCE");
  expect(BUYER_DISPUTE_MEDIA_MAX_ITEMS).toBe(10);
  expect(
    buyerDisputeMediaContextContract.parse({
      contextId: "71000000-0000-4000-8000-000000000001",
      expiresAt: "2026-08-31T09:30:00.000Z",
      maxItems: 10,
      maxBytesPerItem: 10 * 1024 * 1024,
      uploadUrl: "/v1/buyer-dispute-media/71000000-0000-4000-8000-000000000001",
    }),
  ).toMatchObject({ maxItems: 10 });
  expect(
    buyerDisputeMediaContextIdContract.parse("71000000-0000-4000-8000-000000000001"),
  ).toBe("71000000-0000-4000-8000-000000000001");
  expect(buyerDisputeMediaUploadInputContract.parse({ file: "binary" })).toEqual({
    file: "binary",
  });
  expect(
    buyerDisputeMediaUploadInputContract.safeParse({
      file: "binary",
      purpose: "DISPUTE_EVIDENCE",
      orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    }).success,
  ).toBe(false);
  expect(
    buyerDisputeEvidenceReadInputContract.parse({
      identityId: "00000000-0000-4000-8000-000000000101",
      orderId: "00000000-0000-4000-8000-000000000201",
      evidenceId: "00000000-0000-4000-8000-000000000301",
      kind: "IMAGE",
    }),
  ).toMatchObject({ kind: "IMAGE" });
  expect(buyerDisputeEvidenceReadResultContract.parse("READY")).toBe("READY");
  expect(
    mediaUploadInputContract.safeParse({
      purpose: buyerDisputeMediaUploadPurpose,
      file: "binary",
    }).success,
  ).toBe(false);
});
