import { afterEach, describe, expect, it, vi } from "vitest";
import { storeV1Examples } from "@sevo/contracts/store/v1";

import { readPublicProductPage } from "./public-product-page";

describe("public product page read state", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("classifies an authoritative missing product as not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValue(new Response(null, { status: 503 })),
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
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValue(new Response(null, { status: 503 })),
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

  it("keeps a healthy product available when only experiences are offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
            variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
            name: "فنجان سرامیکی",
            description: "فنجان دست‌ساز مناسب نوشیدنی گرم",
            image: {
              id: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
              url: "/v1/media/807c619f-a989-4fd9-8b78-a437a07c7bc4",
            },
            price: { amount: 4_500_000, currency: "IRR" },
            availability: "AVAILABLE",
            publicationVersion: 1,
          }),
        )
        .mockResolvedValueOnce(Response.json(storeV1Examples.PublicStore))
        .mockRejectedValueOnce(new Error("experience feed offline")),
    );

    await expect(readPublicProductPage("store", "product")).resolves.toMatchObject({
      state: "ready",
      experiences: undefined,
    });
  });
});
