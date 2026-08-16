export type StoredMedia = {
  key: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
};

export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");

export interface MediaStorage {
  put(object: StoredMedia): Promise<void>;
  get(key: string): Promise<StoredMedia | undefined>;
}

/** @deprecated Use the module-owned MediaStorage port. */
export type ObjectStoragePort = MediaStorage;
