export type StoredMedia = {
  key: string;
  contentType: string;
  bytes: Uint8Array;
};

export interface ObjectStoragePort {
  put(object: StoredMedia): Promise<void>;
  get(key: string): Promise<StoredMedia | undefined>;
}
