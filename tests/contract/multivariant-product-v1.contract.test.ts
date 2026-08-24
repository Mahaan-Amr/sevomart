import {
  publicProductContract,
  productCombinationKey,
  replaceProductInventoryBatchContract,
  replaceProductOffersBatchContract,
  replaceProductWorkingCopyContract,
  variantAvailabilityChangedV1Contract,
  variantPriceChangedV1Contract,
} from "@sevo/contracts/product/v1";
import { describe, expect, it } from "vitest";

const ids = {
  product: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
  redSmall: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
  redLarge: "1e87db9e-acde-4cfe-bdb0-7da03488c8d1",
  media: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
};

const workingCopy = {
  expectedRevision: 0,
  workingCopy: {
    name: "پیراهن روزمره",
    description: "پارچه نرم و مناسب استفاده روزانه",
    orderedMediaIds: [ids.media],
    axes: [
      {
        clientKey: "color",
        name: " رنگ ",
        values: [{ clientKey: "red", name: " قرمز " }],
      },
      {
        clientKey: "size",
        name: "اندازه",
        values: [
          { clientKey: "small", name: "کوچک" },
          { clientKey: "large", name: "بزرگ" },
        ],
      },
    ],
    variants: [
      {
        clientKey: "red-small",
        combination: [
          { axisClientKey: "color", valueClientKey: "red" },
          { axisClientKey: "size", valueClientKey: "small" },
        ],
        price: { amount: 7_500_000, currency: "IRR" },
        sku: " SHIRT-R-S ",
      },
      {
        clientKey: "red-large",
        combination: [
          { axisClientKey: "color", valueClientKey: "red" },
          { axisClientKey: "size", valueClientKey: "large" },
        ],
        price: { amount: 7_900_000, currency: "IRR" },
        sku: null,
      },
    ],
  },
  inventory: {
    rows: [
      { variantClientKey: "red-small", onHand: 4, expectedRevision: 0 },
      { variantClientKey: "red-large", onHand: 0, expectedRevision: 0 },
    ],
  },
};

describe("multivariant product v1 contract", () => {
  it("accepts two category-neutral axes and revision-based initial stock", () => {
    const parsed = replaceProductWorkingCopyContract.parse(workingCopy);
    expect(parsed.workingCopy.axes[0]?.name).toBe("رنگ");
    expect(parsed.workingCopy.axes[0]?.values[0]?.name).toBe("قرمز");
    expect(parsed.workingCopy.variants[0]?.sku).toBe("SHIRT-R-S");
    expect(parsed.inventory?.rows).toHaveLength(2);
  });

  it("rejects duplicate client keys, combinations and more than fifty variants", () => {
    expect(
      replaceProductWorkingCopyContract.safeParse({
        ...workingCopy,
        workingCopy: {
          ...workingCopy.workingCopy,
          variants: [
            workingCopy.workingCopy.variants[0],
            {
              ...workingCopy.workingCopy.variants[0],
              clientKey: "duplicate-combination",
            },
          ],
        },
      }).success,
    ).toBe(false);

    expect(
      replaceProductWorkingCopyContract.safeParse({
        ...workingCopy,
        workingCopy: {
          ...workingCopy.workingCopy,
          variants: Array.from({ length: 51 }, (_, index) => ({
            clientKey: `variant-${index}`,
            combination: [],
            price: { amount: 1_000, currency: "IRR" },
            sku: null,
          })),
          axes: [],
        },
      }).success,
    ).toBe(false);
  });

  it("preserves the combination property across every axis and selection ordering", () => {
    const selections = [
      { axisClientKey: "color", valueClientKey: "red" },
      { axisClientKey: "size", valueClientKey: "small" },
    ];
    const expectedKey = productCombinationKey(selections);

    for (const axes of permutations(workingCopy.workingCopy.axes)) {
      for (const combination of permutations(selections)) {
        expect(productCombinationKey(combination)).toBe(expectedKey);
        expect(
          replaceProductWorkingCopyContract.safeParse({
            ...workingCopy,
            workingCopy: {
              ...workingCopy.workingCopy,
              axes,
              variants: [
                { ...workingCopy.workingCopy.variants[0], combination },
                {
                  ...workingCopy.workingCopy.variants[0],
                  clientKey: "same-selection-different-order",
                  combination: [...combination].reverse(),
                },
              ],
            },
          }).success,
        ).toBe(false);
      }
    }
  });

  it("defines all-or-nothing offer and inventory batches with row revisions", () => {
    expect(
      replaceProductOffersBatchContract.parse({
        expectedRevision: 3,
        rows: [
          {
            variantId: ids.redSmall,
            price: { amount: 8_000_000, currency: "IRR" },
            sku: "SHIRT-R-S",
            expectedRevision: 1,
          },
          {
            variantId: ids.redLarge,
            price: { amount: 8_400_000, currency: "IRR" },
            sku: null,
            expectedRevision: 1,
          },
        ],
      }).rows,
    ).toHaveLength(2);

    expect(
      replaceProductInventoryBatchContract.parse({
        expectedRevision: 4,
        reasonCode: "MANUAL_COUNT",
        rows: [
          { variantId: ids.redSmall, onHand: 7, expectedRevision: 1 },
          { variantId: ids.redLarge, onHand: 2, expectedRevision: 1 },
        ],
      }).rows,
    ).toHaveLength(2);
  });

  it("keeps SKU and exact inventory out of the public multivariant projection", () => {
    const product = publicProductContract.parse({
      productId: ids.product,
      name: "پیراهن روزمره",
      description: "پارچه نرم و مناسب استفاده روزانه",
      images: [{ id: ids.media, url: `/v1/media/${ids.media}` }],
      axes: [
        { name: "رنگ", values: ["قرمز"] },
        { name: "اندازه", values: ["کوچک", "بزرگ"] },
      ],
      variants: [
        {
          variantId: ids.redSmall,
          combination: [
            { axis: "رنگ", value: "قرمز" },
            { axis: "اندازه", value: "کوچک" },
          ],
          price: { amount: 7_500_000, currency: "IRR" },
          availability: "AVAILABLE",
        },
        {
          variantId: ids.redLarge,
          combination: [
            { axis: "رنگ", value: "قرمز" },
            { axis: "اندازه", value: "بزرگ" },
          ],
          price: { amount: 7_900_000, currency: "IRR" },
          availability: "OUT_OF_STOCK",
        },
      ],
      priceRange: {
        minimum: { amount: 7_500_000, currency: "IRR" },
        maximum: { amount: 7_900_000, currency: "IRR" },
      },
      availability: "AVAILABLE",
      publicationVersion: 1,
    });

    expect(JSON.stringify(product)).not.toMatch(/sku|onHand|revision/i);
  });

  it("versions public offer and availability changes without private stock or SKU", () => {
    const envelope = {
      version: 1,
      eventId: "78ee2a86-221f-4a73-b320-2fd315585c05",
      aggregateId: ids.product,
      aggregateVersion: 4,
      occurredAt: "2026-08-24T12:00:00.000Z",
      correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
      actor: {
        type: "IDENTITY" as const,
        id: "97554510-44c2-4e02-b44f-95c17ff239de",
      },
    };
    const price = variantPriceChangedV1Contract.parse({
      ...envelope,
      eventType: "VariantPriceChanged.v1",
      payload: {
        storeId: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
        productId: ids.product,
        variantId: ids.redSmall,
        publicationVersion: 1,
        offerVersion: 2,
        price: { amount: 8_000_000, currency: "IRR" },
      },
    });
    const availability = variantAvailabilityChangedV1Contract.parse({
      ...envelope,
      eventId: "f08bd717-2ab0-44dc-8171-7c789806dbf9",
      eventType: "VariantAvailabilityChanged.v1",
      payload: {
        storeId: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
        productId: ids.product,
        variantId: ids.redLarge,
        publicationVersion: 1,
        availabilityVersion: 2,
        availability: "AVAILABLE",
      },
    });
    expect(JSON.stringify([price, availability])).not.toMatch(/sku|onHand/i);
  });
});

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length < 2) return [[...values]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidateIndex) => candidateIndex !== index)).map(
      (rest) => [value, ...rest],
    ),
  );
}
