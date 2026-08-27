import { FakeObjectStorage } from "../../apps/api/src/modules/media/testing/fake-object-storage";
import { runObjectStorageContract } from "./object-storage.contract";

runObjectStorageContract("FakeObjectStorage", () => new FakeObjectStorage());

import { expect, it } from "vitest";
import {
  conversationAttachmentInputContract,
  conversationAttachmentResultContract,
  conversationMediaUploadInputContract,
  mediaUploadInputContract,
} from "@sevo/contracts/media/v1";

it("separates private conversation attachments from seller media uploads", () => {
  expect(conversationMediaUploadInputContract.parse({ file: "binary" })).toEqual({
    file: "binary",
  });
  expect(
    mediaUploadInputContract.safeParse({
      purpose: "CONVERSATION_ATTACHMENT",
      file: "binary",
    }).success,
  ).toBe(false);
  const input = {
    identityId: "10000000-0000-4000-8000-000000000001",
    conversationId: "20000000-0000-4000-8000-000000000002",
    mediaId: "30000000-0000-4000-8000-000000000003",
  };
  expect(conversationAttachmentInputContract.parse(input)).toEqual(input);
  expect(
    conversationAttachmentInputContract.safeParse({ ...input, objectKey: "private" })
      .success,
  ).toBe(false);
  expect(conversationAttachmentResultContract.parse("READY")).toBe("READY");
  expect(
    conversationAttachmentResultContract.safeParse({
      status: "READY",
      checksum: "private",
    }).success,
  ).toBe(false);
});

import { MediaAttachmentReader } from "../../apps/api/src/modules/media/composition";

it("does not accept an attachment until its private processed derivative is ready", async () => {
  const storage = new FakeObjectStorage();
  const input = conversationAttachmentInputContract.parse({
    identityId: "10000000-0000-4000-8000-000000000001",
    conversationId: "20000000-0000-4000-8000-000000000002",
    mediaId: "30000000-0000-4000-8000-000000000003",
  });
  const reader = new MediaAttachmentReader(storage);
  await storage.put({
    key: input.mediaId,
    ownerSellerId: input.identityId,
    ownerReferenceId: input.conversationId,
    purpose: "CONVERSATION_ATTACHMENT",
    contentType: "image/png",
    bytes: new Uint8Array([1]),
    checksum: "checksum",
    width: 1,
    height: 1,
    visibility: "PRIVATE",
    variants: [],
  });
  expect(await reader.checkConversationAttachment(input)).toBe("MEDIA_NOT_READY");
  await expect(storage.makePublic(input.mediaId, input.identityId)).rejects.toThrow();
  expect(
    await reader.checkConversationAttachment(
      Object.assign({}, input, { mediaId: "invalid" }),
    ),
  ).toBe("MESSAGE_REJECTED");
});
