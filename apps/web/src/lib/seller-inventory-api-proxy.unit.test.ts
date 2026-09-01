import { afterEach, describe, expect, it, vi } from "vitest";

import { proxySellerInventoryRequest } from "./seller-inventory-api-proxy";

describe("seller inventory API proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards list filters and keeps the private response uncached", async () => {
    const upstream = vi
      .fn()
      .mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", upstream);

    const response = await proxySellerInventoryRequest(
      new Request(
        "http://sevo.test/api/seller/inventory?limit=50&availability=AVAILABLE",
      ),
      [],
    );

    expect(upstream.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3001/v1/seller/inventory?limit=50&availability=AVAILABLE",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("forwards the adjustment payload and idempotency key", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ rows: [] }));
    vi.stubGlobal("fetch", upstream);
    const request = new Request("http://sevo.test/api/seller/inventory", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "inventory-ui-1",
      },
      body: JSON.stringify({ rows: [] }),
    });

    await proxySellerInventoryRequest(request, []);

    const options = upstream.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(options.headers).get("idempotency-key")).toBe("inventory-ui-1");
    expect(options.method).toBe("PUT");
  });

  it("rejects nested paths without contacting the API", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await proxySellerInventoryRequest(
      new Request("http://sevo.test/api/seller/inventory/unexpected"),
      ["unexpected"],
    );

    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
