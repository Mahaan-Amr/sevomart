import { describe, expect, it } from "vitest";
import { conversationMessageV1Contract } from "@sevo/contracts/conversations/v1";

import {
  failOutgoingMessage,
  retryOutgoingMessage,
  settleOutgoingMessage,
  startOutgoingMessage,
} from "./conversation-composer-state";

const conversationId = "7a30197b-85fb-4209-83e8-743ab3bea71c";

describe("seller conversation optimistic messages", () => {
  it("retries a failed message with the same idempotency key", () => {
    const pending = startOutgoingMessage({
      clientId: "draft-one",
      conversationId,
      idempotencyKey: "stable-key",
      content: { type: "TEXT", text: "سلام" },
    });

    const failed = failOutgoingMessage(pending, "پیام فرستاده نشد.");
    const retrying = retryOutgoingMessage(failed);

    expect(retrying.status).toBe("SENDING");
    expect(retrying.idempotencyKey).toBe("stable-key");
    expect(retrying.clientId).toBe("draft-one");
  });

  it("replaces the optimistic item and deduplicates an idempotent replay", () => {
    const pending = startOutgoingMessage({
      clientId: "draft-one",
      conversationId,
      idempotencyKey: "stable-key",
      content: { type: "TEXT", text: "سلام" },
    });
    const sent = conversationMessageV1Contract.parse({
      version: 1 as const,
      messageId: "2c532e73-a701-41b0-98c4-9cad6f8d62dc",
      conversationId,
      senderRole: "SELLER" as const,
      content: pending.content,
      status: "SENT" as const,
      createdAt: "2026-08-29T09:00:00.000Z",
    });

    const settled = settleOutgoingMessage([pending], pending.clientId, sent);
    const replayed = settleOutgoingMessage(settled, pending.clientId, sent);

    expect(replayed).toEqual([sent]);
  });
});
