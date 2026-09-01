import { Module, type DynamicModule } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import {
  IDENTITY_SESSION_READER,
  SELLER_ACCESS_READ,
  type IdentitySessionReader,
  type SellerAccessRead,
} from "../identity-access/public";
import { MEDIA_STORAGE, type MediaStorage } from "../media/public";
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

export function createContentMediaRead(media: MediaStorage): ContentMediaRead {
  return {
    async readOwnedKind(mediaId, identityId) {
      const metadata = await media.inspect(mediaId);
      if (
        metadata?.ownerSellerId !== identityId ||
        metadata.purpose === "CONVERSATION_ATTACHMENT"
      )
        return undefined;
      return metadata.contentType.startsWith("image/") ? "IMAGE" : undefined;
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
    },
  ): DynamicModule {
    const repository =
      options.repository ?? new PostgresContentRepository(environment.DATABASE_URL);
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
          ],
          useFactory: (
            sessions: IdentitySessionReader,
            sellerAccess: SellerAccessRead,
            stores: StoreAuthoritativeRead,
            media: MediaStorage,
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
              createContentMediaRead(media),
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
