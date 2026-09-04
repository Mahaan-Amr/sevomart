import { publicSalesContentFeedV2Contract } from "@sevo/contracts/content/v2";
import { describe, expect, it } from "vitest";

import { buildSalesContentCards } from "./sales-content-view-model";

const content = publicSalesContentFeedV2Contract.parse({
  projectionUpdatedAt: "2026-09-01T10:00:00.000Z",
  items: [
    {
      contentId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
      source: "SELLER",
      storeId: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
      media: {
        mediaId: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
        kind: "VIDEO",
      },
      products: [
        {
          productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
          active: true,
        },
      ],
      publishedAt: "2026-09-01T09:00:00.000Z",
    },
    {
      contentId: "61fe87eb-6c0f-47ca-93ca-9f9a038ca271",
      source: "SELLER",
      storeId: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
      media: {
        mediaId: "707c619f-a989-4fd9-8b78-a437a07c7bc5",
        kind: "IMAGE",
      },
      products: [
        {
          productId: "b78fdcc0-caad-4315-a7cd-b22834fe76d5",
          active: false,
        },
      ],
      publishedAt: "2026-09-01T08:00:00.000Z",
    },
  ],
});

describe("sales-content view model", () => {
  it("keeps seller content distinct and links an out-of-stock product", () => {
    const cards = buildSalesContentCards(
      content,
      [
        {
          productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
          name: "فنجان دست‌ساز",
          href: "/s/khane-sofal/products/a78fdcc0-caad-4315-a7cd-b22834fe76d4",
          priceLabel: "۱۰۰٬۰۰۰ تومان",
          unavailable: true,
        },
      ],
      { includeContentWithoutVisibleProducts: true },
    );

    expect(cards[0]).toMatchObject({
      sourceLabel: "محتوای فروش",
      media: { kind: "VIDEO" },
      product: {
        name: "فنجان دست‌ساز",
        unavailable: true,
        availabilityLabel: "ناموجود",
      },
    });
  });

  it("shows a stopped-content state without inventing a purchase action", () => {
    const cards = buildSalesContentCards(content, [], {
      includeContentWithoutVisibleProducts: true,
    });

    expect(cards[1]).toMatchObject({
      sourceLabel: "محتوای فروش",
      unavailableLabel: "کالای متصل فعلاً قابل خرید نیست.",
    });
    expect(cards[1]).not.toHaveProperty("product");
  });

  it("omits unrelated store content from a product-ranked feed", () => {
    expect(
      buildSalesContentCards(content, [], {
        includeContentWithoutVisibleProducts: false,
      }),
    ).toEqual([]);
  });
});
