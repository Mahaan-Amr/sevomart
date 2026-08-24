import { afterEach, describe, expect, it, vi } from "vitest";

import { proxyAddressesRequest } from "./addresses-api-proxy";

describe("addresses API proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards only one address identifier and preserves retry guidance", async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "IDEMPOTENCY_IN_PROGRESS" }), {
        status: 409,
        headers: { "content-type": "application/json", "retry-after": "1" },
      }),
    );
    vi.stubGlobal("fetch", upstream);
    const addressId = "0fe9edc9-e3b7-47d5-a3d0-290de59d118e";

    const response = await proxyAddressesRequest(
      new Request(`http://sevo.test/api/addresses/${addressId}`, { method: "PUT" }),
      [addressId],
    );

    expect(upstream).toHaveBeenCalledWith(
      `http://127.0.0.1:3001/v1/addresses/${addressId}`,
      expect.any(Object),
    );
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects nested paths without contacting the API", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await proxyAddressesRequest(
      new Request("http://sevo.test/api/addresses/id/unexpected"),
      ["0fe9edc9-e3b7-47d5-a3d0-290de59d118e", "unexpected"],
    );

    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
