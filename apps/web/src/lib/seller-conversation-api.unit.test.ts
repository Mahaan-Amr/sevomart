import { afterEach, describe, expect, it, vi } from "vitest";

import { readNearestSellerConversation } from "./seller-conversation-api";

const firstId = "7a30197b-85fb-4209-83e8-743ab3bea71c";
const storeId = "15f16eaf-1e01-4e40-b0e6-b8ce19268893";

describe("seller conversation API reader", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the producer-owned nearest reply summary with one request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        version: 1,
        status: "ACTIONABLE",
        conversation: thread(firstId),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readNearestSellerConversation("session=one")).resolves.toEqual({
      kind: "ACTIONABLE",
      conversation: thread(firstId),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3001/v1/conversations/needs-reply",
    );
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

  it("maps the producer-owned empty summary without scanning threads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ version: 1, status: "NONE" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readNearestSellerConversation("session=one")).resolves.toEqual({
      kind: "NONE",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
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
