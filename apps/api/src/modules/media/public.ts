import type {
  BuyerDisputeMediaContextId,
  BuyerDisputeEvidenceReadInput,
  BuyerDisputeEvidenceReadResult,
  ConversationAttachmentInput,
  ConversationAttachmentResult,
  MediaUploadPurpose,
  MediaVariant,
  MediaId,
  MediaUploadIdempotencyKey,
  PurchaseExperienceMediaContextId,
} from "@sevo/contracts/media/v1";
import type { OrderItemId } from "@sevo/contracts/orders/v1";
import type { IdentityId } from "@sevo/contracts/platform/v1";
import type { OrderId } from "@sevo/contracts/platform/v1";

export type StoredMediaVariant = {
  key: string;
  name: MediaVariant;
  contentType: "image/webp";
  bytes: Uint8Array;
  width: number;
  height: number;
};

export type StoredMedia = {
  key: string;
  purpose: StoredMediaPurpose;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
  checksum: string;
  width: number;
  height: number;
  variants: StoredMediaVariant[];
  ownerIdentityId: IdentityId;
  ownerReferenceId?: string;
  visibility: "PRIVATE" | "PUBLIC";
};

export type ReadableMedia = Omit<StoredMedia, "bytes" | "variants"> & {
  contentType: "image/webp";
  bytes: Uint8Array;
  variant: MediaVariant;
};

export type MediaMetadata = Omit<StoredMedia, "bytes" | "variants">;

export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");
export const PUBLISHED_MEDIA_ACCESS = Symbol("PUBLISHED_MEDIA_ACCESS");
export const SELLER_UPLOAD_RATE_LIMITER = Symbol("SELLER_UPLOAD_RATE_LIMITER");

export type PublishedMediaAccess = (mediaId: string) => Promise<boolean>;

export interface MediaStorage {
  put(object: StoredMedia): Promise<void>;
  inspect(key: string): Promise<MediaMetadata | undefined>;
  get(key: string, variant?: MediaVariant): Promise<ReadableMedia | undefined>;
  makePublic(key: string, ownerIdentityId: IdentityId): Promise<void>;
  makePrivate(key: string, ownerIdentityId: IdentityId): Promise<void>;
  issuePurchaseExperienceUploadContext(input: {
    identityId: IdentityId;
    orderItemId: OrderItemId;
    expiresAt: Date;
  }): Promise<{ contextId: PurchaseExperienceMediaContextId; expiresAt: Date }>;
  readPurchaseExperienceUploadContext(
    contextId: PurchaseExperienceMediaContextId,
    options?: { includeExpired?: boolean },
  ): Promise<
    { identityId: IdentityId; orderItemId: OrderItemId; expiresAt: Date } | undefined
  >;
  putPurchaseExperienceMedia(input: {
    object: StoredMedia;
    contextId: PurchaseExperienceMediaContextId;
    idempotencyKey: MediaUploadIdempotencyKey;
    requestHash: string;
    maxItems: number;
  }): Promise<MediaMetadata>;
  issueBuyerDisputeUploadContext(input: {
    identityId: IdentityId;
    orderId: OrderId;
    expiresAt: Date;
  }): Promise<{ contextId: BuyerDisputeMediaContextId; expiresAt: Date }>;
  readBuyerDisputeUploadContext(
    contextId: BuyerDisputeMediaContextId,
    options?: { includeExpired?: boolean },
  ): Promise<{ identityId: IdentityId; orderId: OrderId; expiresAt: Date } | undefined>;
  putBuyerDisputeMedia(input: {
    object: StoredMedia;
    contextId: BuyerDisputeMediaContextId;
    idempotencyKey: MediaUploadIdempotencyKey;
    requestHash: string;
    maxItems: number;
  }): Promise<MediaMetadata>;
}

/** @deprecated Use the module-owned MediaStorage port. */
export type ObjectStoragePort = MediaStorage;

export type StoredMediaPurpose =
  | MediaUploadPurpose
  | "CONVERSATION_ATTACHMENT"
  | "DISPUTE_EVIDENCE"
  | "PURCHASE_EXPERIENCE_IMAGE"
  | "BUYER_DISPUTE_EVIDENCE";
export const BUYER_DISPUTE_MEDIA = Symbol("BUYER_DISPUTE_MEDIA");
export type BuyerDisputeMediaAccess = (input: {
  identityId: IdentityId;
  orderId: OrderId;
}) => Promise<boolean>;
export interface BuyerDisputeMedia {
  issueUploadContext(input: {
    identityId: IdentityId;
    orderId: OrderId;
  }): Promise<{ contextId: BuyerDisputeMediaContextId; expiresAt: string }>;
  readUploadContext(
    contextId: BuyerDisputeMediaContextId,
  ): Promise<{ identityId: IdentityId; orderId: OrderId; expiresAt: Date } | undefined>;
}
export class BuyerDisputeMediaAccessDeniedError extends Error {}
export class BuyerDisputeMediaLimitError extends Error {}
export class BuyerDisputeMediaIdempotencyConflictError extends Error {}
export const PURCHASE_EXPERIENCE_MEDIA = Symbol("PURCHASE_EXPERIENCE_MEDIA");
export const PURCHASE_EXPERIENCE_MEDIA_ACCESS = Symbol(
  "PURCHASE_EXPERIENCE_MEDIA_ACCESS",
);
export type PurchaseExperienceMediaAccess = (input: {
  identityId: IdentityId;
  orderItemId: OrderItemId;
}) => Promise<boolean>;
export interface PurchaseExperienceMedia {
  issueUploadContext(input: {
    identityId: IdentityId;
    orderItemId: OrderItemId;
  }): Promise<{ contextId: PurchaseExperienceMediaContextId; expiresAt: string }>;
  readUploadContext(
    contextId: PurchaseExperienceMediaContextId,
  ): Promise<
    { identityId: IdentityId; orderItemId: OrderItemId; expiresAt: Date } | undefined
  >;
  checkReadyForPublication(input: {
    identityId: IdentityId;
    orderItemId: OrderItemId;
    mediaIds: readonly MediaId[];
  }): Promise<boolean>;
}

export class PurchaseExperienceMediaLimitError extends Error {}
export class PurchaseExperienceMediaIdempotencyConflictError extends Error {}
export const CONVERSATION_MEDIA_ACCESS = Symbol("CONVERSATION_MEDIA_ACCESS");
export const CONVERSATION_ATTACHMENT_READER = Symbol("CONVERSATION_ATTACHMENT_READER");
export const DISPUTE_EVIDENCE_READER = Symbol("DISPUTE_EVIDENCE_READER");
export const DISPUTE_MEDIA_ACCESS = Symbol("DISPUTE_MEDIA_ACCESS");
/** No mediaId: active membership for upload/owner preview. With mediaId: membership AND a sent message in that thread. */
export type ConversationMediaAccess = (input: {
  identityId: string;
  conversationId: string;
  mediaId?: string;
}) => Promise<boolean>;
export interface ConversationAttachmentReader {
  checkConversationAttachment(
    input: ConversationAttachmentInput,
  ): Promise<ConversationAttachmentResult>;
}
export interface DisputeEvidenceReader {
  isReadyBuyerEvidence(
    input: BuyerDisputeEvidenceReadInput,
  ): Promise<BuyerDisputeEvidenceReadResult>;
  isReadySellerEvidence(input: {
    identityId: string;
    disputeId: string;
    evidenceId: string;
    kind: "IMAGE" | "DOCUMENT" | "MESSAGE_REFERENCE";
  }): Promise<boolean>;
}
export type DisputeMediaAccess = (input: {
  identityId: string;
  disputeId: string;
}) => Promise<boolean>;
