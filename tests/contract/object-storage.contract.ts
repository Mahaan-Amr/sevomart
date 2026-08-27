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

import { randomUUID } from "node:crypto";
import { conversationAttachmentInputContract } from "@sevo/contracts/media/v1";
import { MediaAttachmentReader } from "../../apps/api/src/modules/media/composition";
import type { StoredMedia } from "../../apps/api/src/modules/media/public";

export function runConversationAttachmentStorageContract(
  name: string,
  createStorage: () => ObjectStoragePort,
) {
  describe(`${name} private attachment contract`, () => {
    const attachment = (): StoredMedia => ({
      key: randomUUID(),
      ownerSellerId: randomUUID(),
      ownerReferenceId: randomUUID(),
      purpose: "CONVERSATION_ATTACHMENT",
      contentType: "image/png",
      bytes: new Uint8Array([1]),
      checksum: "0".repeat(64),
      width: 1,
      height: 1,
      visibility: "PRIVATE",
      variants: [
        {
          key: `media/${randomUUID()}/preview.webp`,
          name: "attachment-preview",
          contentType: "image/webp",
          bytes: new Uint8Array([2]),
          width: 1,
          height: 1,
        },
      ],
    });
    it("requires private visibility and a conversation reference at ingestion", async () => {
      const storage = createStorage();
      await expect(
        storage.put({ ...attachment(), visibility: "PUBLIC" }),
      ).rejects.toThrow();
      await expect(
        storage.put({ ...attachment(), ownerReferenceId: undefined }),
      ).rejects.toThrow();
    });
    it("keeps processed attachments private and checks actor and context", async () => {
      const storage = createStorage();
      const media = attachment();
      await storage.put(media);
      const reader = new MediaAttachmentReader(storage);
      const input = conversationAttachmentInputContract.parse({
        identityId: media.ownerSellerId,
        conversationId: media.ownerReferenceId,
        mediaId: media.key,
      });
      expect(await reader.checkConversationAttachment(input)).toBe("READY");
      await expect(
        storage.makePublic(media.key, media.ownerSellerId),
      ).rejects.toThrow();
      expect((await storage.inspect(media.key))?.visibility).toBe("PRIVATE");
      for (const field of ["identityId", "conversationId", "mediaId"] as const)
        expect(
          await reader.checkConversationAttachment(
            conversationAttachmentInputContract.parse({
              ...input,
              [field]: randomUUID(),
            }),
          ),
        ).toBe("MESSAGE_REJECTED");
    });
    it("does not accept a missing processed derivative or malformed identifier", async () => {
      const storage = createStorage();
      const media = attachment();
      media.variants[0]!.name = "product-detail";
      await storage.put(media);
      const reader = new MediaAttachmentReader(storage);
      const input = conversationAttachmentInputContract.parse({
        identityId: media.ownerSellerId,
        conversationId: media.ownerReferenceId,
        mediaId: media.key,
      });
      expect(await reader.checkConversationAttachment(input)).toBe("MEDIA_NOT_READY");
      expect(
        await reader.checkConversationAttachment(
          Object.assign({}, input, { mediaId: "invalid" }),
        ),
      ).toBe("MESSAGE_REJECTED");
    });
  });
}
