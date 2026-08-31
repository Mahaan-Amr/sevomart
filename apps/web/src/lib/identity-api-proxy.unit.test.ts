import { afterEach, describe, expect, it, vi } from "vitest";

import { proxyIdentityRequest } from "./identity-api-proxy";

describe("identity API proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves query parameters and Retry-After", async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "IDEMPOTENCY_IN_PROGRESS" }), {
        status: 409,
        headers: { "content-type": "application/json", "retry-after": "1" },
      }),
    );
    vi.stubGlobal("fetch", upstream);

    const response = await proxyIdentityRequest(
      new Request("http://sevo.test/api/seller-applications/mine?limit=1&cursor=next"),
      "/v1/seller-applications/mine",
    );

    expect(upstream).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/v1/seller-applications/mine?limit=1&cursor=next",
      expect.any(Object),
    );
    expect(response.headers.get("retry-after")).toBe("1");
  });

  it("forwards the case-scoped grant and reason used to audit a sensitive reveal", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", upstream);
    const encodedReason = encodeURIComponent("بررسی مدرک پرونده تخلف برای اقدام بعدی");

    await proxyIdentityRequest(
      new Request("http://sevo.test/api/platform/violations/case-id", {
        headers: {
          cookie: "sevo_platform_session=agent",
          "x-platform-access-grant-id": "555c67ad-b996-4165-b639-ce080f7a0225",
          "x-platform-access-reason": encodedReason,
        },
      }),
      "/v1/platform/violations/case-id",
    );

    expect(upstream).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/v1/platform/violations/case-id",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-platform-access-grant-id": "555c67ad-b996-4165-b639-ce080f7a0225",
          "x-platform-access-reason": encodedReason,
        }),
      }),
    );
  });
});
