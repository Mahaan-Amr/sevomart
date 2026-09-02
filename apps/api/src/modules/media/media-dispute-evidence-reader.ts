import { buyerDisputeMediaContextIdContract } from "@sevo/contracts/media/v1";

import type { DisputeEvidenceReader, MediaStorage } from "./public";

export class MediaDisputeEvidenceReader implements DisputeEvidenceReader {
  constructor(private readonly storage: MediaStorage) {}

  async isReadyBuyerEvidence(
    input: Parameters<DisputeEvidenceReader["isReadyBuyerEvidence"]>[0],
  ) {
    if (input.kind !== "IMAGE") return "NOT_READY" as const;
    const media = await this.storage.inspect(input.evidenceId);
    const contextId = buyerDisputeMediaContextIdContract.safeParse(
      media?.ownerReferenceId,
    );
    const context = contextId.success
      ? await this.storage.readBuyerDisputeUploadContext(contextId.data, {
          includeExpired: true,
        })
      : undefined;
    const valid = Boolean(
      media?.purpose === "BUYER_DISPUTE_EVIDENCE" &&
      media.visibility === "PRIVATE" &&
      media.ownerIdentityId === input.identityId &&
      context?.identityId === input.identityId &&
      context.orderId === input.orderId,
    );
    if (!valid || !media) return "NOT_READY" as const;
    return (await this.storage.get(media.key, "attachment-preview"))
      ? ("READY" as const)
      : ("NOT_READY" as const);
  }

  async isReadySellerEvidence(input: {
    identityId: string;
    disputeId: string;
    evidenceId: string;
    kind: "IMAGE" | "DOCUMENT" | "MESSAGE_REFERENCE";
  }) {
    const media = await this.storage.inspect(input.evidenceId);
    if (
      !media ||
      media.ownerIdentityId !== input.identityId ||
      media.ownerReferenceId !== input.disputeId ||
      media.purpose !== "DISPUTE_EVIDENCE" ||
      media.visibility !== "PRIVATE"
    )
      return false;
    if (input.kind !== "IMAGE") return false;
    return Boolean(await this.storage.get(media.key, "attachment-preview"));
  }
}
