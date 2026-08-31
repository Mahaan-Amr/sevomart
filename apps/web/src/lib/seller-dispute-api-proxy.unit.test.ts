import { afterEach, describe, expect, it, vi } from "vitest";

import { proxySellerDisputesRequest } from "./seller-dispute-api-proxy";

const disputeId = "4df3e69a-4d9c-4c5b-9bf2-75af372e18e1";

describe("seller disputes API proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards private list and detail reads to the v1 producer", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ items: [] }));
    vi.stubGlobal("fetch", upstream);

    const list = await proxySellerDisputesRequest(
      new Request("http://sevo.test/api/seller/disputes?limit=20"),
      [],
    );
    const detail = await proxySellerDisputesRequest(
      new Request(`http://sevo.test/api/seller/disputes/${disputeId}`),
      [disputeId],
    );

    expect(upstream.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3001/v1/seller/disputes?limit=20",
    );
    expect(upstream.mock.calls[1]?.[0]).toBe(
      `http://127.0.0.1:3001/v1/seller/disputes/${disputeId}`,
    );
    expect(list.headers.get("cache-control")).toBe("no-store");
    expect(detail.headers.get("cache-control")).toBe("no-store");
  });

  it("forwards response mutations to v2 with the idempotency key", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ disputeId }));
    vi.stubGlobal("fetch", upstream);
    const request = new Request(
      `http://sevo.test/api/seller/disputes/${disputeId}/response`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "seller-response-01",
        },
        body: JSON.stringify({ response: "پاسخ روشن فروشگاه", evidence: [] }),
      },
    );

    await proxySellerDisputesRequest(request, [disputeId, "response"]);

    expect(upstream.mock.calls[0]?.[0]).toBe(
      `http://127.0.0.1:3001/v2/seller/disputes/${disputeId}/response`,
    );
    const init = upstream.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("idempotency-key")).toBe("seller-response-01");
  });

  it("rejects invalid identifiers and non-canonical paths", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    for (const segments of [["not-a-dispute"], [disputeId, "unexpected"]]) {
      const response = await proxySellerDisputesRequest(
        new Request(`http://sevo.test/api/seller/disputes/${segments.join("/")}`),
        segments,
      );
      expect(response.status).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
});
