import { describe, expect, it } from "vitest";

import {
  calculateInventoryTarget,
  matchesInventorySearch,
  parseInventoryQuantity,
  variantLabelsFromSellerProduct,
} from "./seller-inventory-model";

describe("seller inventory input", () => {
  it("accepts Persian, Arabic, and Latin whole numbers", () => {
    expect(parseInventoryQuantity("۱۲٬۳۴۵")).toBe(12_345);
    expect(parseInventoryQuantity("١٢٣")).toBe(123);
    expect(parseInventoryQuantity(" 42 ")).toBe(42);
  });

  it("rejects negative, decimal, and unsafe quantities", () => {
    expect(parseInventoryQuantity("-۱")).toBeUndefined();
    expect(parseInventoryQuantity("۱٫۵")).toBeUndefined();
    expect(parseInventoryQuantity("9007199254740992")).toBeUndefined();
  });

  it("calculates increase, decrease, and corrected totals without going negative", () => {
    expect(calculateInventoryTarget("INCREASE", 8, "۳")).toEqual({ value: 11 });
    expect(calculateInventoryTarget("DECREASE", 8, "3")).toEqual({ value: 5 });
    expect(calculateInventoryTarget("CORRECT", 8, "۳")).toEqual({ value: 3 });
    expect(calculateInventoryTarget("DECREASE", 2, "۳")).toEqual({
      error: "موجودی نمی‌تواند کمتر از صفر شود. مقدار کاهش را کمتر کنید.",
    });
  });
});

describe("seller inventory search", () => {
  it("finds a variant by product name or feature text with Persian letter variants", () => {
    const item = {
      productName: "کیف روزمره",
      variantLabel: "رنگ: آبی، اندازه: بزرگ",
    };

    expect(matchesInventorySearch(item, "كيف")).toBe(true);
    expect(matchesInventorySearch(item, "آبی بزرگ")).toBe(true);
    expect(matchesInventorySearch(item, "قرمز")).toBe(false);
  });

  it("builds searchable feature labels from the seller product read", () => {
    const variantId = "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7";
    expect(
      variantLabelsFromSellerProduct({
        productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
        state: "PUBLISHED",
        revision: 3,
        publicationVersion: 1,
        workingCopy: {
          name: "کیف روزمره",
          description: "",
          orderedMediaIds: ["807c619f-a989-4fd9-8b78-a437a07c7bc4"],
          axes: [
            {
              clientKey: "color",
              name: "رنگ",
              values: [{ clientKey: "blue", name: "آبی" }],
            },
          ],
          variants: [
            {
              clientKey: "blue",
              variantId,
              combination: [{ axisClientKey: "color", valueClientKey: "blue" }],
              price: { amount: 4_500_000, currency: "IRR" },
              sku: null,
              offerRevision: 1,
            },
          ],
        },
        inventory: [{ variantId, onHand: 8, revision: 2 }],
      }),
    ).toEqual(new Map([[variantId, "رنگ: آبی"]]));
  });
});
