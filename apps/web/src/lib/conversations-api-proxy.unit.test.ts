import { afterEach, describe, expect, it, vi } from "vitest";

import { proxyConversationsRequest } from "./conversations-api-proxy";

describe("conversations API proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards list cursors and message idempotency without caching private data", async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: 1, items: [] }), {
        headers: { "content-type": "application/json", "retry-after": "2" },
      }),
    );
    vi.stubGlobal("fetch", upstream);
    const conversationId = "7a30197b-85fb-4209-83e8-743ab3bea71c";

    const response = await proxyConversationsRequest(
      new Request(
        `http://sevo.test/api/conversations/${conversationId}/messages?cursor=older`,
        { method: "POST", headers: { "idempotency-key": "send-message-01" } },
      ),
      [conversationId, "messages"],
    );

    expect(upstream).toHaveBeenCalledWith(
      `http://127.0.0.1:3001/v1/conversations/${conversationId}/messages?cursor=older`,
      expect.any(Object),
    );
    const init = upstream.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("idempotency-key")).toBe("send-message-01");
    expect(response.headers.get("retry-after")).toBe("2");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects non-conversation paths without contacting the API", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await proxyConversationsRequest(
      new Request("http://sevo.test/api/conversations/not-a-thread/private"),
      ["not-a-thread", "private"],
    );

    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
