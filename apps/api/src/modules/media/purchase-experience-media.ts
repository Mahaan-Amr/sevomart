import {
  PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS,
  purchaseExperienceMediaContextIdContract,
  purchaseExperienceMediaUploadPurpose,
} from "@sevo/contracts/media/v1";

import type { MediaStorage, PurchaseExperienceMedia } from "./public";

const UPLOAD_CONTEXT_LIFETIME_MS = 30 * 60 * 1000;

export class PurchaseExperienceMediaService implements PurchaseExperienceMedia {
  constructor(
    private readonly storage: MediaStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issueUploadContext(
    input: Parameters<PurchaseExperienceMedia["issueUploadContext"]>[0],
  ) {
    const expiresAt = new Date(this.now().getTime() + UPLOAD_CONTEXT_LIFETIME_MS);
    const context = await this.storage.issuePurchaseExperienceUploadContext({
      ...input,
      expiresAt,
    });
    return { contextId: context.contextId, expiresAt: context.expiresAt.toISOString() };
  }

  readUploadContext(
    contextId: Parameters<PurchaseExperienceMedia["readUploadContext"]>[0],
  ) {
    return this.storage.readPurchaseExperienceUploadContext(contextId);
  }

  async checkReadyForPublication(
    input: Parameters<PurchaseExperienceMedia["checkReadyForPublication"]>[0],
  ) {
    if (input.mediaIds.length > PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS) return false;
    const metadata = await Promise.all(
      input.mediaIds.map((mediaId) => this.storage.inspect(mediaId)),
    );
    const contexts = await Promise.all(
      metadata.map((item) =>
        item?.ownerReferenceId
          ? this.storage.readPurchaseExperienceUploadContext(
              purchaseExperienceMediaContextIdContract.parse(item.ownerReferenceId),
              { includeExpired: true },
            )
          : undefined,
      ),
    );
    return metadata.every((item, index) => {
      const context = contexts[index];
      return (
        item?.purpose === purchaseExperienceMediaUploadPurpose &&
        item.visibility === "PRIVATE" &&
        item.ownerIdentityId === input.identityId &&
        context?.identityId === input.identityId &&
        context.orderItemId === input.orderItemId
      );
    });
  }
}
