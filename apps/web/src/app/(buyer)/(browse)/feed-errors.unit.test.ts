import { describe, expect, it } from "vitest";

import { classifyFeedError, cursorNotice } from "./feed-errors";

describe("buyer feed error copy", () => {
  it.each([
    ["INVALID_CURSOR", "ادامه این فید معتبر نبود؛ از ابتدا شروع کردیم."],
    ["CURSOR_EXPIRED", "این فید قدیمی بود؛ تازه‌اش کردیم."],
    ["FEED_CURSOR_STALE", "فروشگاه‌های دنبال‌شده تغییر کردند؛ فید را تازه کردیم."],
  ])("maps %s to its own following-feed notice", (code, message) => {
    expect(cursorNotice(code, "following")).toBe(message);
  });

  it("does not expose an inactive identity as a retryable server message", () => {
    expect(classifyFeedError("IDENTITY_INACTIVE")).toEqual({
      message: "دسترسی این هویت به دنبال‌شده‌ها فعال نیست.",
      retryable: false,
      goToDiscovery: true,
    });
  });
});
