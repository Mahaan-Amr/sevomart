import { afterEach, describe, expect, it, vi } from "vitest";

import { proxySellerSalesContentRequest } from "./seller-sales-content-api-proxy";

describe("seller sales-content API proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards authenticated list and idempotent writes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-correlation-id": "cid" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("http://localhost/api/seller/sales-content", {
      method: "POST",
      headers: {
        cookie: "session=secret",
        "content-type": "application/json",
        "idempotency-key": "content-key-1",
      },
      body: JSON.stringify({ storeId: crypto.randomUUID() }),
    });

    const response = await proxySellerSalesContentRequest(request, []);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/v2/seller/sales-content",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: expect.any(Headers),
      }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("cookie")).toBe("session=secret");
    expect(headers.get("idempotency-key")).toBe("content-key-1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects unknown paths before reaching the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxySellerSalesContentRequest(
      new Request("http://localhost/api/seller/sales-content/not-an-id"),
      ["not-an-id"],
    );
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
