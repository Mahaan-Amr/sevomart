import { afterEach, describe, expect, it, vi } from "vitest";

import {
  proxySellerBuyersRequest,
  proxySellerOrderDeliveryRevealRequest,
} from "./seller-buyers-api-proxy";

describe("seller buyers API proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the contextual search and keeps buyer data uncached", async () => {
    const upstream = vi
      .fn()
      .mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", upstream);

    const response = await proxySellerBuyersRequest(
      new Request("http://sevo.test/api/seller/buyers?search=%D8%B3%D8%A7%D8%B1%D8%A7"),
      [],
    );

    expect(upstream.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3001/v1/seller/buyers?search=%D8%B3%D8%A7%D8%B1%D8%A7",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects nested buyer paths without contacting the API", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await proxySellerBuyersRequest(
      new Request("http://sevo.test/api/seller/buyers/unexpected"),
      ["unexpected"],
    );

    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards an order-scoped delivery reveal with its human reason", async () => {
    const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef";
    const upstream = vi.fn().mockResolvedValue(Response.json({ orderId }));
    vi.stubGlobal("fetch", upstream);
    const request = new Request(
      `http://sevo.test/api/seller/orders/${orderId}/delivery-details/reveal`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "پیگیری ارسال سفارش خریدار" }),
      },
    );

    const response = await proxySellerOrderDeliveryRevealRequest(request, orderId);

    expect(response.status).toBe(200);
    expect(upstream.mock.calls[0]?.[0]).toBe(
      `http://127.0.0.1:3001/v1/seller/orders/${orderId}/delivery-details/reveal`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const options = upstream.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(new TextDecoder().decode(options.body as ArrayBuffer))).toEqual({
      reason: "پیگیری ارسال سفارش خریدار",
    });
  });
});
