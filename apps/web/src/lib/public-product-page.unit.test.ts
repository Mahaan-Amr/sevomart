import { afterEach, describe, expect, it, vi } from "vitest";

import { readPublicProductPage } from "./public-product-page";

describe("public product page read state", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("classifies an authoritative missing product as not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    await expect(readPublicProductPage("store", "product")).resolves.toEqual({
      state: "not-found",
    });
  });

  it("keeps an upstream failure distinct from not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    await expect(readPublicProductPage("store", "product")).resolves.toEqual({
      state: "error",
    });
  });

  it("rejects an invalid public contract as a retryable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ unexpected: true })),
    );

    await expect(readPublicProductPage("store", "product")).resolves.toEqual({
      state: "error",
    });
  });

  it("classifies a rejected fetch as a retryable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(readPublicProductPage("store", "product")).resolves.toEqual({
      state: "error",
    });
  });
});
