import { afterEach, describe, expect, it, vi } from "vitest";

import {
  proxyConversationMediaRequest,
  proxyConversationsRequest,
} from "./conversations-api-proxy";

describe("conversations API proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards list cursors, the session and retry guidance without caching", async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "IDEMPOTENCY_IN_PROGRESS" }), {
        status: 409,
        headers: { "content-type": "application/json", "retry-after": "1" },
      }),
    );
    vi.stubGlobal("fetch", upstream);

    const response = await proxyConversationsRequest(
      new Request("http://sevo.test/api/conversations?limit=20&cursor=next", {
        headers: { cookie: "sevo_identity_session=session" },
      }),
      [],
    );

    expect(upstream.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3001/v1/conversations?limit=20&cursor=next",
    );
    const init = upstream.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("cookie")).toBe(
      "sevo_identity_session=session",
    );
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("forwards message idempotency and cursors", async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: 1, items: [] }), {
        headers: { "content-type": "application/json", "retry-after": "2" },
      }),
    );
    vi.stubGlobal("fetch", upstream);
    const conversationId = "7a30197b-85fb-4209-83e8-743ab3bea71c";

    await proxyConversationsRequest(
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
  });

  it("allows only canonical thread, message and attachment paths", async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", upstream);
    const conversationId = "7a30197b-85fb-4209-83e8-743ab3bea71c";

    for (const segments of [
      [conversationId],
      [conversationId, "messages"],
      [conversationId, "media"],
    ]) {
      const response = await proxyConversationsRequest(
        new Request(`http://sevo.test/api/conversations/${segments.join("/")}`),
        segments,
      );
      expect(response.status).toBe(200);
    }

    const rejected = await proxyConversationsRequest(
      new Request(`http://sevo.test/api/conversations/${conversationId}/unexpected`),
      [conversationId, "unexpected"],
    );
    expect(rejected.status).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("streams a private attachment through its authenticated media route", async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "cache-control": "private, no-store",
        },
      }),
    );
    vi.stubGlobal("fetch", upstream);
    const mediaId = "6014fdd4-e393-4100-a037-030b781b6637";

    const response = await proxyConversationMediaRequest(
      new Request(`http://sevo.test/api/conversation-media/${mediaId}`, {
        headers: { cookie: "sevo_identity_session=session" },
      }),
      mediaId,
    );

    expect(upstream).toHaveBeenCalledWith(
      `http://127.0.0.1:3001/v1/media/${mediaId}`,
      expect.any(Object),
    );
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
