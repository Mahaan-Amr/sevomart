import { describe, expect, it } from "vitest";

import { conversationErrorPresentation } from "./conversation-errors";

describe("conversation error presentation", () => {
  it("gives an expired cursor a Persian restart step", () => {
    expect(
      conversationErrorPresentation({
        version: 1,
        code: "CURSOR_EXPIRED",
        message: "expired",
        correlationId: "17de9c74-f6e1-4bda-843d-9ecf95918c3e",
      }),
    ).toEqual({
      code: "CURSOR_EXPIRED",
      message: "مهلت ادامه این فهرست تمام شده است.",
      nextStep: "فهرست را از ابتدا تازه کنید.",
    });
  });

  it("uses retry details for an in-progress idempotent request", () => {
    expect(
      conversationErrorPresentation({
        version: 1,
        code: "IDEMPOTENCY_IN_PROGRESS",
        message: "busy",
        correlationId: "17de9c74-f6e1-4bda-843d-9ecf95918c3e",
        details: { retryAfterSeconds: 3 },
      }),
    ).toMatchObject({
      message: "درخواست قبلی هنوز در حال انجام است.",
      nextStep: "۳ ثانیه صبر کنید و دوباره تلاش کنید.",
    });
  });

  it("falls back safely when the response is not a conversation error", () => {
    expect(conversationErrorPresentation({ nope: true })).toEqual({
      code: "UNKNOWN",
      message: "گفت‌وگو در دسترس نیست.",
      nextStep: "اتصال را بررسی کنید و دوباره تلاش کنید.",
    });
  });
});
