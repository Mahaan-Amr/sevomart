import { describe, expect, it } from "vitest";

import type { ObjectStoragePort } from "../../apps/api/src/modules/media/public";

export function runObjectStorageContract(
  adapterName: string,
  createStorage: () => ObjectStoragePort,
): void {
  describe(`${adapterName} object storage contract`, () => {
    it("returns the bytes and metadata stored under a key", async () => {
      const storage = createStorage();
      const expected = {
        key: "media/example",
        contentType: "image/webp",
        bytes: new Uint8Array([1, 2, 3]),
        ownerSellerId: "seller-test",
        visibility: "PRIVATE" as const,
      };

      await storage.put(expected);

      expect(await storage.get(expected.key)).toEqual(expected);
    });

    it("does not expose mutable stored bytes", async () => {
      const storage = createStorage();
      const bytes = new Uint8Array([7]);
      await storage.put({
        key: "media/isolated",
        contentType: "image/webp",
        bytes,
        ownerSellerId: "seller-test",
        visibility: "PRIVATE",
      });

      bytes[0] = 9;

      expect((await storage.get("media/isolated"))?.bytes[0]).toBe(7);
    });

    it("makes an existing private object public", async () => {
      const storage = createStorage();
      await storage.put({
        key: "media/publication",
        contentType: "image/png",
        bytes: new Uint8Array([1]),
        ownerSellerId: "seller-test",
        visibility: "PRIVATE",
      });

      await storage.makePublic("media/publication", "seller-test");

      expect(await storage.get("media/publication")).toMatchObject({
        ownerSellerId: "seller-test",
        visibility: "PUBLIC",
      });
    });

    it("does not publish media for a different seller", async () => {
      const storage = createStorage();
      await storage.put({
        key: "media/private-owner",
        contentType: "image/png",
        bytes: new Uint8Array([1]),
        ownerSellerId: "seller-test",
        visibility: "PRIVATE",
      });

      await expect(
        storage.makePublic("media/private-owner", "seller-other"),
      ).rejects.toThrow("not owned");
      expect(await storage.get("media/private-owner")).toMatchObject({
        visibility: "PRIVATE",
      });
    });

    it("returns public media to private for its owner", async () => {
      const storage = createStorage();
      await storage.put({
        key: "media/unpublished",
        contentType: "image/png",
        bytes: new Uint8Array([1]),
        ownerSellerId: "seller-test",
        visibility: "PRIVATE",
      });
      await storage.makePublic("media/unpublished", "seller-test");

      await storage.makePrivate("media/unpublished", "seller-test");

      expect(await storage.get("media/unpublished")).toMatchObject({
        visibility: "PRIVATE",
      });
    });
  });
}
