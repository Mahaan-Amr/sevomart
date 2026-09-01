import { afterEach, describe, expect, it, vi } from "vitest";

import { proxyStoreRequest } from "./store-api-proxy";

describe("store API proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the validated seller-product pagination query", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ items: [] }));
    vi.stubGlobal("fetch", upstream);
    const cursor = "eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTMwIn0";

    await proxyStoreRequest(
      new Request(
        `http://localhost/api/store/seller/products?limit=20&cursor=${cursor}&state=DRAFT&ignored=private`,
      ),
      ["seller", "products"],
    );

    expect(upstream).toHaveBeenCalledWith(
      `http://127.0.0.1:3001/v1/seller/products?cursor=${cursor}&limit=20&state=DRAFT`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });
});
