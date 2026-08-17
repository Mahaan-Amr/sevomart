import type { MediaUploadPurpose, MediaVariant } from "@sevo/contracts/media/v1";

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
  purpose: MediaUploadPurpose;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
  checksum: string;
  width: number;
  height: number;
  variants: StoredMediaVariant[];
  ownerSellerId: string;
  visibility: "PRIVATE" | "PUBLIC";
};

export type ReadableMedia = Omit<StoredMedia, "bytes" | "variants"> & {
  contentType: "image/webp";
  bytes: Uint8Array;
  variant: MediaVariant;
};

export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");

export interface MediaStorage {
  put(object: StoredMedia): Promise<void>;
  get(key: string, variant?: MediaVariant): Promise<ReadableMedia | undefined>;
  makePublic(key: string, ownerSellerId: string): Promise<void>;
  makePrivate(key: string, ownerSellerId: string): Promise<void>;
}

/** @deprecated Use the module-owned MediaStorage port. */
export type ObjectStoragePort = MediaStorage;
