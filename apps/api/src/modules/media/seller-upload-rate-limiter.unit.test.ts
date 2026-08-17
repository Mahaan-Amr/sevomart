import { describe, expect, it } from "vitest";

import { SellerUploadRateLimiter } from "./seller-upload-rate-limiter";

describe("SellerUploadRateLimiter", () => {
  it("rejects the thirteenth upload in a rolling minute", () => {
    let now = 1_000;
    const limiter = new SellerUploadRateLimiter(() => now);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(limiter.accept("seller-1")).toBe(true);
    }
    expect(limiter.accept("seller-1")).toBe(false);

    now += 60_000;
    expect(limiter.accept("seller-1")).toBe(true);
  });

  it("keeps upload windows isolated by seller", () => {
    const limiter = new SellerUploadRateLimiter(() => 1_000);

    for (let attempt = 0; attempt < 12; attempt += 1) limiter.accept("seller-1");

    expect(limiter.accept("seller-2")).toBe(true);
  });
});
