import type { DisputeEvidenceReader, MediaStorage } from "./public";

export class MediaDisputeEvidenceReader implements DisputeEvidenceReader {
  constructor(private readonly storage: MediaStorage) {}

  async isReadySellerEvidence(input: {
    identityId: string;
    disputeId: string;
    evidenceId: string;
  }) {
    const media = await this.storage.inspect(input.evidenceId);
    if (
      !media ||
      media.ownerSellerId !== input.identityId ||
      media.ownerReferenceId !== input.disputeId ||
      media.purpose !== "DISPUTE_EVIDENCE" ||
      media.visibility !== "PRIVATE"
    )
      return false;
    return Boolean(await this.storage.get(media.key, "attachment-preview"));
  }
}
