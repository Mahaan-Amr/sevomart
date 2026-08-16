export type StoredMedia = {
  key: string;
  contentType: string;
  bytes: Uint8Array;
};

export interface MediaStorage {
  put(object: StoredMedia): Promise<void>;
  get(key: string): Promise<StoredMedia | undefined>;
}

/** @deprecated Use the module-owned MediaStorage port. */
export type ObjectStoragePort = MediaStorage;
