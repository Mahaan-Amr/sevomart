import type {
  ContentError,
  OrderItemId,
  PurchaseExperience,
  SalesContent,
} from "@sevo/contracts/content/v1";
import type {
  ProductPurchaseExperiences,
  PublishPurchaseExperienceInputV2,
  PublishSalesContentInputV2,
  PurchaseExperienceEligibilityDecisionV2,
  PurchaseExperienceMediaContext,
} from "@sevo/contracts/content/v2";
import type { MediaId } from "@sevo/contracts/media/v1";
import type { IdentityId, ProductId, StoreId } from "@sevo/contracts/platform/v1";

export const CONTENT_SERVICE = Symbol("CONTENT_SERVICE");

export type ContentRequest = Readonly<{
  sessionToken?: string;
  correlationId: string;
}>;

export class ContentFault extends Error {
  constructor(readonly code: ContentError["code"] | "UNAUTHENTICATED") {
    super(code);
  }
}

export interface ContentSessionRead {
  readActiveIdentitySession(token: string): Promise<{ identityId: string } | undefined>;
}
export interface ContentSellerAccessRead {
  isActiveSeller(identityId: IdentityId): Promise<boolean>;
}
export interface ContentStoreRead {
  requireOwnedSellable(identityId: IdentityId, storeId: StoreId): Promise<unknown>;
}
export interface ContentProductRead {
  readPublishedProduct(
    productId: ProductId,
    storeId: StoreId,
  ): Promise<{ publicationVersion: number } | undefined>;
}
export interface ContentMediaRead {
  readOwnedKind(mediaId: MediaId, identityId: IdentityId): Promise<"IMAGE" | undefined>;
  issuePurchaseExperienceUploadContext(input: {
    identityId: IdentityId;
    orderItemId: OrderItemId;
  }): Promise<PurchaseExperienceMediaContext>;
  arePurchaseExperienceImagesReady(input: {
    identityId: IdentityId;
    orderItemId: OrderItemId;
    mediaIds: readonly MediaId[];
  }): Promise<boolean>;
}
export interface PurchaseEligibilityRead {
  readEligibility(input: {
    buyerId: IdentityId;
    orderItemId: OrderItemId;
  }): Promise<PurchaseExperienceEligibilityDecisionV2>;
}

export type ContentMutation = Readonly<{
  actorId: IdentityId;
  correlationId: string;
  idempotencyKey: string;
  requestHash: string;
}>;
export type PublishSalesContentCommand = ContentMutation &
  Readonly<{
    input: PublishSalesContentInputV2;
    products: ReadonlyArray<{
      productId: ProductId;
      publicationVersion: number;
    }>;
  }>;
export type PublishPurchaseExperienceCommand = ContentMutation &
  Readonly<{
    input: PublishPurchaseExperienceInputV2;
    storeId: StoreId;
    productId: ProductId;
  }>;

export interface ContentRepository {
  replaySalesContent(command: ContentMutation): Promise<SalesContent | undefined>;
  replayPurchaseExperience(
    command: ContentMutation,
  ): Promise<PurchaseExperience | undefined>;
  publishSalesContent(command: PublishSalesContentCommand): Promise<SalesContent>;
  publishPurchaseExperience(
    command: PublishPurchaseExperienceCommand,
  ): Promise<PurchaseExperience>;
  hasPurchaseExperience(orderItemId: OrderItemId): Promise<boolean>;
  readProductPurchaseExperiences(
    productId: ProductId,
  ): Promise<ProductPurchaseExperiences>;
}

export interface ContentPublishedMediaRead {
  isMediaPublished(mediaId: MediaId): Promise<boolean>;
}
