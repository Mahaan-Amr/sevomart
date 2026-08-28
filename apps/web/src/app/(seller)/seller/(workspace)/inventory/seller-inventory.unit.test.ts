import {
  productViewContract,
  simpleProductViewContract,
} from "@sevo/contracts/product/v1";
import { describe, expect, it } from "vitest";

import { buildInventoryWrite, toInventoryProduct } from "./seller-inventory-model";

describe("seller inventory labels", () => {
  it("joins reordered inventory rows to variants by id and names their attributes", () => {
    const firstVariantId = "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7";
    const secondVariantId = "b3991ca0-50f6-44b9-a4b2-5ae917e5dac7";
    const product = productViewContract.parse({
      productId: "c3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
      state: "PUBLISHED",
      revision: 3,
      publicationVersion: 1,
      workingCopy: {
        name: "فنجان",
        description: "",
        orderedMediaIds: [],
        axes: [
          {
            clientKey: "color",
            name: "رنگ",
            values: [
              { clientKey: "red", name: "قرمز" },
              { clientKey: "blue", name: "آبی" },
            ],
          },
        ],
        variants: [
          {
            clientKey: "red-cup",
            variantId: firstVariantId,
            combination: [{ axisClientKey: "color", valueClientKey: "red" }],
            price: { amount: 100_000, currency: "IRR" },
            sku: null,
            offerRevision: 1,
          },
          {
            clientKey: "blue-cup",
            variantId: secondVariantId,
            combination: [{ axisClientKey: "color", valueClientKey: "blue" }],
            price: { amount: 100_000, currency: "IRR" },
            sku: null,
            offerRevision: 1,
          },
        ],
      },
      inventory: [
        { variantId: secondVariantId, onHand: 2, revision: 4 },
        { variantId: firstVariantId, onHand: 5, revision: 3 },
      ],
    });

    expect(toInventoryProduct("فنجان", product).rows).toMatchObject([
      { variantId: secondVariantId, label: "رنگ: آبی", onHand: 2 },
      { variantId: firstVariantId, label: "رنگ: قرمز", onHand: 5 },
    ]);
  });

  it("preserves a simple product working copy while replacing its inventory", () => {
    const mediaId = "d3991ca0-50f6-44b9-a4b2-5ae917e5dac7";
    const variantId = "e3991ca0-50f6-44b9-a4b2-5ae917e5dac7";
    const product = simpleProductViewContract.parse({
      productId: "f3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
      state: "PUBLISHED",
      revision: 7,
      publicationVersion: 1,
      workingCopy: {
        name: "فنجان ساده",
        description: "توضیح حفظ‌شده",
        orderedMediaIds: [mediaId],
        variant: {
          variantId,
          price: { amount: 250_000, currency: "IRR" },
        },
      },
      inventory: { onHand: 3, revision: 5 },
    });
    const inventoryProduct = toInventoryProduct("فنجان ساده", product);
    inventoryProduct.rows[0]!.onHand = 9;

    expect(buildInventoryWrite(inventoryProduct)).toEqual({
      endpoint: "working-copy",
      body: {
        expectedRevision: 7,
        workingCopy: {
          name: "فنجان ساده",
          description: "توضیح حفظ‌شده",
          orderedMediaIds: [mediaId],
          variant: {
            clientKey: variantId,
            price: { amount: 250_000, currency: "IRR" },
          },
        },
        inventory: { onHand: 9, expectedRevision: 5 },
      },
    });
  });
});
