import { describe, expect, it } from "vitest";

import {
  calculateInventoryTarget,
  inventoryErrorGuidance,
  matchesInventorySearch,
  parseInventoryQuantity,
  prepareInventoryWrite,
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
});

describe("seller inventory write recovery", () => {
  it("reuses the idempotency key for an ambiguous retry of the same payload", () => {
    const first = prepareInventoryWrite(undefined, '{"rows":[1]}', () => "key-1");
    expect(prepareInventoryWrite(first, '{"rows":[1]}', () => "key-2")).toBe(first);
    expect(prepareInventoryWrite(first, '{"rows":[2]}', () => "key-2")).toEqual({
      payload: '{"rows":[2]}',
      idempotencyKey: "key-2",
    });
  });

  it("provides local Persian guidance for every typed producer error", () => {
    for (const code of [
      "INVENTORY_NOT_FOUND",
      "REVISION_CONFLICT",
      "IDEMPOTENCY_CONFLICT",
      "RESERVED_STOCK_CONFLICT",
      "SELLER_ACCESS_INACTIVE",
      "VALIDATION_ERROR",
      "PRECONDITION_REQUIRED",
      "UNAUTHORIZED",
    ] as const) {
      expect(inventoryErrorGuidance(code).message.length).toBeGreaterThan(10);
    }
    expect(inventoryErrorGuidance("UNAUTHORIZED").recovery).toBe("LOGIN");
    expect(inventoryErrorGuidance("REVISION_CONFLICT").recovery).toBe("REFRESH");
  });
});
