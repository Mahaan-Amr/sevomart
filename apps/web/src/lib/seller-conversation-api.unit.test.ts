import { afterEach, describe, expect, it, vi } from "vitest";

import { readNearestSellerConversation } from "./seller-conversation-api";

const firstId = "7a30197b-85fb-4209-83e8-743ab3bea71c";
const secondId = "8a30197b-85fb-4209-83e8-743ab3bea71c";
const storeId = "15f16eaf-1e01-4e40-b0e6-b8ce19268893";

describe("seller conversation API reader", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the newest thread whose latest message needs a seller response", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/conversations?limit=50")) {
        return Response.json({
          version: 1,
          items: [thread(firstId), thread(secondId)],
        });
      }
      if (url.includes(firstId)) {
        return Response.json({ version: 1, items: [message(firstId, "SELLER")] });
      }
      return Response.json({ version: 1, items: [message(secondId, "BUYER")] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(readNearestSellerConversation("session=one")).resolves.toEqual({
      kind: "ACTIONABLE",
      conversation: thread(secondId),
    });
  });

  it("does not turn an invalid upstream payload into an empty inbox", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ items: "broken" })),
    );

    await expect(readNearestSellerConversation("session=one")).resolves.toEqual({
      kind: "UNAVAILABLE",
    });
  });
});

function thread(conversationId: string) {
  return {
    version: 1 as const,
    conversationId,
    context: { kind: "STORE" as const, storeId },
    viewerRole: "SELLER" as const,
    createdAt: "2026-08-29T09:00:00.000Z",
    updatedAt: "2026-08-29T09:00:00.000Z",
  };
}

function message(conversationId: string, senderRole: "BUYER" | "SELLER") {
  return {
    version: 1 as const,
    messageId: crypto.randomUUID(),
    conversationId,
    senderRole,
    content: { type: "TEXT" as const, text: "سلام" },
    status: "SENT" as const,
    createdAt: "2026-08-29T09:00:00.000Z",
  };
}
