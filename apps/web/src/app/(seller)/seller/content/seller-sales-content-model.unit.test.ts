import { describe, expect, it } from "vitest";

import {
  activeProductOptions,
  contentPurchaseMessage,
  sellerContentError,
  validateContentImage,
  validateSalesContentDraft,
} from "./seller-sales-content-model";

describe("seller sales content model", () => {
  it("offers only published products", () => {
    expect(
      activeProductOptions([
        product("PUBLISHED", "فعال"),
        product("UNPUBLISHED", "متوقف"),
        product("DRAFT", "پیش‌نویس"),
      ]).map((item) => item.name),
    ).toEqual(["فعال"]);
  });

  it("validates cover type, size, and the 1–10 unique product rule", () => {
    expect(
      validateContentImage(new File(["x"], "clip.mp4", { type: "video/mp4" })),
    ).toContain("ویدیو");
    expect(
      validateContentImage(
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
          type: "image/png",
        }),
      ),
    ).toContain("۱۰ مگابایت");
    expect(validateSalesContentDraft({ mediaId: "media", productIds: [] })).toContain(
      "دست‌کم",
    );
    expect(
      validateSalesContentDraft({ mediaId: "media", productIds: ["one", "one"] }),
    ).toContain("یک‌بار");
  });

  it("explains stopped purchasing and recoverable conflicts", () => {
    expect(contentPurchaseMessage(false)).toContain("غیرفعال");
    expect(sellerContentError({ code: "REVISION_CONFLICT" }, "خطا")).toContain(
      "تازه کنید",
    );
  });
});

function product(state: "DRAFT" | "PUBLISHED" | "UNPUBLISHED", name: string) {
  return {
    productId: crypto.randomUUID(),
    name,
    primaryMediaId: null,
    state,
    revision: 1,
    publicationVersion: state === "PUBLISHED" ? 1 : 0,
  } as never;
}
