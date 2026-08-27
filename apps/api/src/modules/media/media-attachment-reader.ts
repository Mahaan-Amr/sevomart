import {
  conversationAttachmentInputContract,
  type ConversationAttachmentInput,
  type ConversationAttachmentResult,
} from "@sevo/contracts/media/v1";
import type { ConversationAttachmentReader, MediaStorage } from "./public";

export class MediaAttachmentReader implements ConversationAttachmentReader {
  constructor(private readonly storage: MediaStorage) {}
  async checkConversationAttachment(
    input: ConversationAttachmentInput,
  ): Promise<ConversationAttachmentResult> {
    const parsed = conversationAttachmentInputContract.safeParse(input);
    if (!parsed.success) return "MESSAGE_REJECTED";
    const media = await this.storage.inspect(parsed.data.mediaId);
    if (
      !media ||
      media.ownerSellerId !== parsed.data.identityId ||
      media.ownerReferenceId !== parsed.data.conversationId ||
      media.purpose !== "CONVERSATION_ATTACHMENT" ||
      media.visibility !== "PRIVATE"
    )
      return "MESSAGE_REJECTED";
    const ready = await this.storage.get(media.key, "attachment-preview");
    return ready ? "READY" : "MEDIA_NOT_READY";
  }
}
