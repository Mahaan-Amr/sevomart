import type { ObjectStoragePort, StoredMedia } from "../public";

export class FakeObjectStorage implements ObjectStoragePort {
  readonly #objects = new Map<string, StoredMedia>();

  async put(object: StoredMedia): Promise<void> {
    this.#objects.set(object.key, {
      ...object,
      bytes: object.bytes.slice(),
    });
  }

  async get(key: string): Promise<StoredMedia | undefined> {
    const object = this.#objects.get(key);
    return object ? { ...object, bytes: object.bytes.slice() } : undefined;
  }
}
