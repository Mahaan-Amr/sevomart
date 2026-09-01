import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { FakeObjectStorage } from "./testing/fake-object-storage";
import { PostgresMinioMediaStorage } from "./infrastructure/postgres-minio-media-storage";
import {
  CONVERSATION_MEDIA_ACCESS,
  CONVERSATION_ATTACHMENT_READER,
  DISPUTE_EVIDENCE_READER,
  DISPUTE_MEDIA_ACCESS,
  type ConversationMediaAccess,
  type DisputeMediaAccess,
  MEDIA_STORAGE,
  PURCHASE_EXPERIENCE_MEDIA,
  PURCHASE_EXPERIENCE_MEDIA_ACCESS,
  PUBLISHED_MEDIA_ACCESS,
  SELLER_UPLOAD_RATE_LIMITER,
  type MediaStorage,
  type PublishedMediaAccess,
  type PurchaseExperienceMediaAccess,
} from "./public";
import { PurchaseExperienceMediaService } from "./purchase-experience-media";
import { MediaAttachmentReader } from "./media-attachment-reader";
import { MediaDisputeEvidenceReader } from "./media-dispute-evidence-reader";
import { MediaController } from "./media.controller";
import { SellerUploadRateLimiter } from "./seller-upload-rate-limiter";

@Module({})
export class MediaModule {
  static register(
    environment: RuntimeEnvironment,
    storage?: MediaStorage,
    publishedMediaAccess: PublishedMediaAccess = async () => false,
    conversationMediaAccess: ConversationMediaAccess = async () => false,
    disputeMediaAccess: DisputeMediaAccess = async () => false,
    purchaseExperienceMediaAccess: PurchaseExperienceMediaAccess = async () => false,
  ): DynamicModule {
    const configuredStorage =
      storage ??
      (environment.SEVO_RUNTIME_ENV === "test"
        ? new FakeObjectStorage()
        : new PostgresMinioMediaStorage(environment));
    return {
      module: MediaModule,
      global: true,
      controllers: [MediaController],
      providers: [
        { provide: CONVERSATION_MEDIA_ACCESS, useValue: conversationMediaAccess },
        { provide: DISPUTE_MEDIA_ACCESS, useValue: disputeMediaAccess },
        {
          provide: PURCHASE_EXPERIENCE_MEDIA_ACCESS,
          useValue: purchaseExperienceMediaAccess,
        },
        {
          provide: CONVERSATION_ATTACHMENT_READER,
          useValue: new MediaAttachmentReader(configuredStorage),
        },
        {
          provide: DISPUTE_EVIDENCE_READER,
          useValue: new MediaDisputeEvidenceReader(configuredStorage),
        },
        { provide: MEDIA_STORAGE, useValue: configuredStorage },
        {
          provide: PURCHASE_EXPERIENCE_MEDIA,
          useValue: new PurchaseExperienceMediaService(configuredStorage),
        },
        { provide: PUBLISHED_MEDIA_ACCESS, useValue: publishedMediaAccess },
        {
          provide: SELLER_UPLOAD_RATE_LIMITER,
          useValue: new SellerUploadRateLimiter(),
        },
      ],
      exports: [
        MEDIA_STORAGE,
        PURCHASE_EXPERIENCE_MEDIA,
        CONVERSATION_ATTACHMENT_READER,
        DISPUTE_EVIDENCE_READER,
      ],
    };
  }
}
