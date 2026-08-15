import { describe, expect, it } from "vitest";

import { FakeObjectStorage } from "../../apps/api/src/modules/media/testing/fake-object-storage";
import type { ObjectStoragePort } from "../../apps/api/src/modules/media/public";

function objectStorageContract(createStorage: () => ObjectStoragePort): void {
  describe("object storage contract", () => {
    it("returns the bytes and metadata stored under a key", async () => {
      const storage = createStorage();
      const expected = {
        key: "media/example",
        contentType: "image/webp",
        bytes: new Uint8Array([1, 2, 3]),
      };

      await storage.put(expected);

      expect(await storage.get(expected.key)).toEqual(expected);
    });

    it("does not expose mutable stored bytes", async () => {
      const storage = createStorage();
      const bytes = new Uint8Array([7]);
      await storage.put({ key: "media/isolated", contentType: "image/webp", bytes });

      bytes[0] = 9;

      expect((await storage.get("media/isolated"))?.bytes[0]).toBe(7);
    });
  });
}

objectStorageContract(() => new FakeObjectStorage());
