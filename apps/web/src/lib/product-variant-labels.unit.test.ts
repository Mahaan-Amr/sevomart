import { describe, expect, it } from "vitest";

import {
  variantLabelsFromPublishedProduct,
  variantLabelsFromSellerProduct,
} from "./product-variant-labels";

const productId = "a78fdcc0-caad-4315-a7cd-b22834fe76d4";
const variantId = "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7";
const mediaId = "807c619f-a989-4fd9-8b78-a437a07c7bc4";

describe("product variant display labels", () => {
  it("uses the published snapshot label independently of a newer working copy", () => {
    expect(
      variantLabelsFromPublishedProduct({
        productId,
        name: "کیف روزمره",
        description: "",
        images: [{ id: mediaId, url: `/v1/media/${mediaId}` }],
        axes: [{ name: "رنگ", values: ["آبی"] }],
        variants: [
          {
            variantId,
            combination: [{ axis: "رنگ", value: "آبی" }],
            price: { amount: 4_500_000, currency: "IRR" },
            availability: "AVAILABLE",
          },
        ],
        priceRange: {
          minimum: { amount: 4_500_000, currency: "IRR" },
          maximum: { amount: 4_500_000, currency: "IRR" },
        },
        availability: "AVAILABLE",
        publicationVersion: 1,
      }),
    ).toEqual(new Map([[variantId, "رنگ: آبی"]]));
  });

  it("can fall back to the seller working copy when no public read is available", () => {
    expect(
      variantLabelsFromSellerProduct({
        productId,
        state: "PUBLISHED",
        revision: 3,
        publicationVersion: 1,
        workingCopy: {
          name: "کیف روزمره",
          description: "",
          orderedMediaIds: [mediaId],
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
