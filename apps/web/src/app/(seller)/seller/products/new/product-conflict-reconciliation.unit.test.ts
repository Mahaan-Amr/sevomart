import { describe, expect, it } from "vitest";

import {
  applyRevisionConflictChoices,
  buildRevisionConflictReview,
  type ProductAuthoringSnapshot,
} from "./product-conflict-reconciliation";

const serverSnapshot: ProductAuthoringSnapshot = {
  name: "فنجان تازه",
  description: "توضیح نسخه تازه",
  orderedMediaIds: ["00000000-0000-4000-8000-000000000002"],
  axes: [],
  variants: [
    {
      clientKey: "main",
      variantId: "00000000-0000-4000-8000-000000000010",
      combination: [],
      priceToman: "420000",
      sku: "SERVER-SKU",
      onHand: "7",
      inventoryRevision: 4,
    },
  ],
};

describe("product revision conflict reconciliation", () => {
  it("merges reviewed working-copy fields without replacing untouched server changes", () => {
    const localSnapshot: ProductAuthoringSnapshot = {
      ...serverSnapshot,
      name: "فنجان دست‌ساز من",
      description: "توضیح محلی",
      orderedMediaIds: ["00000000-0000-4000-8000-000000000001"],
    };
    const review = buildRevisionConflictReview(
      "working-copy",
      localSnapshot,
      serverSnapshot,
    );

    expect(review.items.map((item) => item.key)).toEqual([
      "name",
      "description",
      "images",
    ]);
    expect(review.items[0]).toMatchObject({
      title: "نام کالا",
      localSummary: expect.stringContaining("فنجان دست‌ساز من"),
      serverSummary: expect.stringContaining("فنجان تازه"),
    });
    expect(review.items[2]).toMatchObject({
      kind: "images",
      localSummary: "۱ تصویر در انتخاب شما",
      serverSummary: "۱ تصویر در نسخه تازه",
      localMediaIds: localSnapshot.orderedMediaIds,
      serverMediaIds: serverSnapshot.orderedMediaIds,
    });

    const merged = applyRevisionConflictChoices(review, {
      name: "server",
      description: "local",
      images: "server",
    });

    expect(merged).toMatchObject({
      name: "فنجان تازه",
      description: "توضیح محلی",
      orderedMediaIds: serverSnapshot.orderedMediaIds,
      variants: serverSnapshot.variants,
    });
  });

  it("reapplies a reviewed offer on top of the fresh server revision", () => {
    const localSnapshot: ProductAuthoringSnapshot = {
      ...serverSnapshot,
      variants: serverSnapshot.variants.map((variant) => ({
        ...variant,
        priceToman: "450000",
        sku: "LOCAL-SKU",
        inventoryRevision: 2,
      })),
    };
    const review = buildRevisionConflictReview("offers", localSnapshot, serverSnapshot);

    expect(review.items).toEqual([
      expect.objectContaining({
        key: "offer-price:00000000-0000-4000-8000-000000000010",
        title: "قیمت گونه اصلی",
        localSummary: "۴۵۰٬۰۰۰ تومان",
        serverSummary: "۴۲۰٬۰۰۰ تومان",
      }),
      expect.objectContaining({
        key: "offer-sku:00000000-0000-4000-8000-000000000010",
        title: "شناسه گونه اصلی",
        localSummary: "LOCAL-SKU",
        serverSummary: "SERVER-SKU",
      }),
    ]);

    const merged = applyRevisionConflictChoices(review, {
      "offer-price:00000000-0000-4000-8000-000000000010": "local",
      "offer-sku:00000000-0000-4000-8000-000000000010": "server",
    });

    expect(merged.variants[0]).toMatchObject({
      priceToman: "450000",
      sku: "SERVER-SKU",
      onHand: "7",
      inventoryRevision: 4,
    });
  });

  it("lets the seller keep fresh server inventory instead of overwriting it", () => {
    const localSnapshot: ProductAuthoringSnapshot = {
      ...serverSnapshot,
      variants: serverSnapshot.variants.map((variant) => ({
        ...variant,
        onHand: "3",
        inventoryRevision: 2,
      })),
    };
    const review = buildRevisionConflictReview(
      "inventory",
      localSnapshot,
      serverSnapshot,
    );

    expect(review.items).toEqual([
      expect.objectContaining({
        key: "inventory:00000000-0000-4000-8000-000000000010",
        title: "موجودی گونه اصلی",
        localSummary: "۳ عدد",
        serverSummary: "۷ عدد",
      }),
    ]);

    const merged = applyRevisionConflictChoices(review, {
      "inventory:00000000-0000-4000-8000-000000000010": "server",
    });

    expect(merged.variants[0]).toMatchObject({
      priceToman: "420000",
      sku: "SERVER-SKU",
      onHand: "7",
      inventoryRevision: 4,
    });
  });

  it("describes changed axes and values instead of showing counts alone", () => {
    const localSnapshot: ProductAuthoringSnapshot = {
      ...serverSnapshot,
      axes: [
        {
          clientKey: "color",
          name: "رنگ",
          values: [{ clientKey: "red", name: "قرمز" }],
        },
      ],
      variants: [
        {
          ...serverSnapshot.variants[0]!,
          combination: [{ axisClientKey: "color", valueClientKey: "red" }],
        },
      ],
    };
    const review = buildRevisionConflictReview(
      "working-copy",
      localSnapshot,
      serverSnapshot,
    );

    expect(review.items).toContainEqual(
      expect.objectContaining({
        key: "structure",
        localSummary: "رنگ: قرمز · ۱ گونه",
        serverSummary: "کالای ساده با ۱ گونه",
      }),
    );
  });
});
