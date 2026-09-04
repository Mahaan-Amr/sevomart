import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("following feed browser proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the signed-in session and validated cursor to the personal feed", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ items: [] }));
    vi.stubGlobal("fetch", upstream);
    const cursor = "eyJraWQiOiJjdXJyZW50In0.signature";

    await GET(
      new Request(`http://localhost/api/following?cursor=${cursor}`, {
        headers: { cookie: "sevo_identity_session=signed" },
      }),
    );

    expect(upstream).toHaveBeenCalledWith(
      `http://127.0.0.1:3001/v1/me/feeds/following?limit=18&cursor=${cursor}`,
      expect.objectContaining({ cache: "no-store" }),
    );
    const options = upstream.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(options.headers).get("cookie")).toBe(
      "sevo_identity_session=signed",
    );
  });

  it("rejects an oversized cursor before contacting the API", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await GET(
      new Request(`http://localhost/api/following?cursor=${"x".repeat(2_049)}`),
    );

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
