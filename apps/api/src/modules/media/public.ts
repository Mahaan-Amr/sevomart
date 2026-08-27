import type {
  ConversationAttachmentInput,
  ConversationAttachmentResult,
  MediaUploadPurpose,
  MediaVariant,
} from "@sevo/contracts/media/v1";

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
  ownerSellerId: string;
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
  makePublic(key: string, ownerSellerId: string): Promise<void>;
  makePrivate(key: string, ownerSellerId: string): Promise<void>;
}

/** @deprecated Use the module-owned MediaStorage port. */
export type ObjectStoragePort = MediaStorage;

export type StoredMediaPurpose = MediaUploadPurpose | "CONVERSATION_ATTACHMENT";
export const CONVERSATION_MEDIA_ACCESS = Symbol("CONVERSATION_MEDIA_ACCESS");
export const CONVERSATION_ATTACHMENT_READER = Symbol("CONVERSATION_ATTACHMENT_READER");
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
