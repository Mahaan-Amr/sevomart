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
        purpose: "STORE_LOGO" as const,
        contentType: "image/webp",
        bytes: new Uint8Array([1, 2, 3]),
        checksum: "original-checksum",
        width: 1,
        height: 1,
        variants: [
          {
            key: "media/example/logo-large.webp",
            name: "logo-large" as const,
            contentType: "image/webp" as const,
            bytes: new Uint8Array([4, 5, 6]),
            width: 1,
            height: 1,
          },
        ],
        ownerSellerId: "seller-test",
        visibility: "PRIVATE" as const,
      };

      await storage.put(expected);

      expect(await storage.get(expected.key)).toMatchObject({
        key: expected.key,
        bytes: new Uint8Array([4, 5, 6]),
        contentType: "image/webp",
        variant: "logo-large",
        checksum: "original-checksum",
      });
    });

    it("does not expose mutable stored bytes", async () => {
      const storage = createStorage();
      const bytes = new Uint8Array([7]);
      await storage.put({
        key: "media/isolated",
        purpose: "STORE_LOGO",
        contentType: "image/webp",
        bytes,
        checksum: "checksum",
        width: 1,
        height: 1,
        variants: [
          {
            key: "media/isolated/logo-large.webp",
            name: "logo-large",
            contentType: "image/webp",
            bytes: new Uint8Array([7]),
            width: 1,
            height: 1,
          },
        ],
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
        purpose: "STORE_LOGO",
        contentType: "image/png",
        bytes: new Uint8Array([1]),
        checksum: "checksum",
        width: 1,
        height: 1,
        variants: [
          {
            key: "media/publication/logo-large.webp",
            name: "logo-large",
            contentType: "image/webp",
            bytes: new Uint8Array([1]),
            width: 1,
            height: 1,
          },
        ],
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
        purpose: "STORE_LOGO",
        contentType: "image/png",
        bytes: new Uint8Array([1]),
        checksum: "checksum",
        width: 1,
        height: 1,
        variants: [
          {
            key: "media/private-owner/logo-large.webp",
            name: "logo-large",
            contentType: "image/webp",
            bytes: new Uint8Array([1]),
            width: 1,
            height: 1,
          },
        ],
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
        purpose: "STORE_LOGO",
        contentType: "image/png",
        bytes: new Uint8Array([1]),
        checksum: "checksum",
        width: 1,
        height: 1,
        variants: [
          {
            key: "media/unpublished/logo-large.webp",
            name: "logo-large",
            contentType: "image/webp",
            bytes: new Uint8Array([1]),
            width: 1,
            height: 1,
          },
        ],
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
