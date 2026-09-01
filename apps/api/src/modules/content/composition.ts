import { Module, type DynamicModule } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";
import { purchaseExperienceMediaContextContract } from "@sevo/contracts/content/v2";
import {
  MEDIA_UPLOAD_MAX_BYTES,
  PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS,
} from "@sevo/contracts/media/v1";

import {
  IDENTITY_SESSION_READER,
  SELLER_ACCESS_READ,
  type IdentitySessionReader,
  type SellerAccessRead,
} from "../identity-access/public";
import {
  MEDIA_STORAGE,
  PURCHASE_EXPERIENCE_MEDIA,
  type MediaStorage,
  type PurchaseExperienceMedia,
  type PurchaseExperienceMediaAccess,
} from "../media/public";
import { STORE_AUTHORITATIVE_READ, type StoreAuthoritativeRead } from "../store/public";
import { ContentService } from "./application/content.service";
import { ContentController } from "./content.controller";
import { PostgresContentRepository } from "./infrastructure/postgres-content.repository";
import {
  CONTENT_SERVICE,
  type ContentProductRead,
  type ContentRepository,
  type ContentMediaRead,
  type PurchaseEligibilityRead,
} from "./public";

export function createContentMediaRead(
  media: MediaStorage,
  purchaseExperienceMedia: PurchaseExperienceMedia,
): ContentMediaRead {
  return {
    async readOwnedKind(mediaId, identityId) {
      const metadata = await media.inspect(mediaId);
      if (
        metadata?.ownerIdentityId !== identityId ||
        metadata.purpose !== "PRODUCT_IMAGE"
      )
        return undefined;
      return metadata.contentType.startsWith("image/") ? "IMAGE" : undefined;
    },
    async issuePurchaseExperienceUploadContext(input) {
      const context = await purchaseExperienceMedia.issueUploadContext(input);
      return purchaseExperienceMediaContextContract.parse({
        ...context,
        maxItems: PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS,
        maxBytesPerItem: MEDIA_UPLOAD_MAX_BYTES,
        uploadUrl: `/v1/purchase-experience-media/${context.contextId}`,
      });
    },
    arePurchaseExperienceImagesReady(input) {
      return purchaseExperienceMedia.checkReadyForPublication(input);
    },
  };
}

@Module({})
export class ContentModule {
  static register(
    environment: RuntimeEnvironment,
    options: {
      products: ContentProductRead;
      purchases: PurchaseEligibilityRead;
      repository?: ContentRepository;
      onMediaAccessReady?: (access: PurchaseExperienceMediaAccess) => void;
    },
  ): DynamicModule {
    const repository =
      options.repository ?? new PostgresContentRepository(environment.DATABASE_URL);
    options.onMediaAccessReady?.(async (input) => {
      if (await repository.hasPurchaseExperience(input.orderItemId)) return false;
      return (
        await options.purchases.readEligibility({
          buyerId: input.identityId,
          orderItemId: input.orderItemId,
        })
      ).eligible;
    });
    return {
      module: ContentModule,
      controllers: [ContentController],
      providers: [
        { provide: PostgresContentRepository, useValue: repository },
        {
          provide: CONTENT_SERVICE,
          inject: [
            IDENTITY_SESSION_READER,
            SELLER_ACCESS_READ,
            STORE_AUTHORITATIVE_READ,
            MEDIA_STORAGE,
            PURCHASE_EXPERIENCE_MEDIA,
          ],
          useFactory: (
            sessions: IdentitySessionReader,
            sellerAccess: SellerAccessRead,
            stores: StoreAuthoritativeRead,
            media: MediaStorage,
            purchaseExperienceMedia: PurchaseExperienceMedia,
          ) =>
            new ContentService(
              repository,
              {
                async readActiveIdentitySession(token) {
                  const session = await sessions.readActiveIdentitySession(token);
                  return session ? { identityId: session.actor.identityId } : undefined;
                },
              },
              sellerAccess,
              stores,
              options.products,
              createContentMediaRead(media, purchaseExperienceMedia),
              options.purchases,
            ),
        },
      ],
      exports: [CONTENT_SERVICE],
    };
  }
}

export { PostgresContentRepository } from "./infrastructure/postgres-content.repository";
export { createOrderPurchaseEligibilityRead } from "./order-purchase-eligibility.adapter";
