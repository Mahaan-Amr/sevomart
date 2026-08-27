import { FakeObjectStorage } from "../../apps/api/src/modules/media/testing/fake-object-storage";
import {
  runConversationAttachmentStorageContract,
  runObjectStorageContract,
} from "./object-storage.contract";

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

runConversationAttachmentStorageContract(
  "FakeObjectStorage",
  () => new FakeObjectStorage(),
);
