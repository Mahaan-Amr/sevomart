import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import { mediaIdContract } from "../../media-v1";
import {
  eventActorV1Contract,
  eventEnvelopeV1Contract,
  moneyV1Contract,
  productIdContract,
  storeIdContract,
  variantIdContract,
} from "../../platform/v1/index";

export const productIdempotencyKeyContract = z.string().min(1).max(200);
export const productRevisionTagContract = z.string().regex(/^"\d+"$/);
export const sellerProductPageLimitContract = z.coerce.number().int().min(1).max(50);
export const sellerProductCursorContract = z.string().regex(/^[A-Za-z0-9_-]{20,500}$/);
export const sellerProductCursorBoundaryContract = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    productId: productIdContract,
  })
  .strict();
export const sellerProductStateContract = z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED"]);

const productPriceContract = moneyV1Contract.refine(
  ({ amount }) => amount > 0 && amount % 10 === 0 && Number.isSafeInteger(amount),
  "Price must be a positive safe IRR amount divisible by ten",
);

export const productAuthoritativeVariantV1Contract = z
  .object({
    productId: productIdContract,
    variantId: variantIdContract,
    storeId: storeIdContract,
    name: z.string().min(1),
    image: z.object({ id: mediaIdContract, url: z.string().min(1) }).strict(),
    unitPrice: productPriceContract,
    publicationVersion: z.int().positive(),
    sellable: z.boolean(),
  })
  .strict();

export type ProductAuthoritativeVariantV1 = z.infer<
  typeof productAuthoritativeVariantV1Contract
>;

const clientKeyContract = z.string().trim().min(1).max(100);

export function productCombinationKey(
  combination: readonly {
    axisClientKey: string;
    valueClientKey: string;
  }[],
): string {
  if (combination.length === 0) return "";
  return JSON.stringify(
    combination
      .map(
        ({ axisClientKey, valueClientKey }) => [axisClientKey, valueClientKey] as const,
      )
      .sort(([leftAxis, leftValue], [rightAxis, rightValue]) => {
        if (leftAxis !== rightAxis) return leftAxis < rightAxis ? -1 : 1;
        return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
      }),
  );
}
const skuContract = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (value) =>
      Array.from(value).every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint > 31 && codePoint !== 127;
      }),
    "SKU cannot contain control characters",
  );

const productAxisInputContract = z
  .object({
    clientKey: clientKeyContract,
    name: z.string().trim().min(1).max(50),
    values: z
      .array(
        z
          .object({
            clientKey: clientKeyContract,
            name: z.string().trim().min(1).max(50),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

const productVariantInputContract = z
  .object({
    clientKey: clientKeyContract,
    combination: z
      .array(
        z
          .object({
            axisClientKey: clientKeyContract,
            valueClientKey: clientKeyContract,
          })
          .strict(),
      )
      .max(2),
    price: productPriceContract.nullable(),
    sku: skuContract.nullable(),
  })
  .strict();

const productWorkingCopyInputContract = z
  .object({
    name: z.string().trim().min(2).max(120).nullable(),
    description: z.string().trim().max(2_000).default(""),
    orderedMediaIds: z.array(mediaIdContract).max(6),
    axes: z.array(productAxisInputContract).max(2),
    variants: z.array(productVariantInputContract).max(50),
  })
  .strict()
  .superRefine((workingCopy, context) => {
    const normalized = (value: string) =>
      value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("fa");
    const unique = (values: string[]) => new Set(values).size === values.length;
    const axisKeys = workingCopy.axes.map((axis) => axis.clientKey);
    const axisNames = workingCopy.axes.map((axis) => normalized(axis.name));
    if (!unique(axisKeys) || !unique(axisNames)) {
      context.addIssue({
        code: "custom",
        path: ["axes"],
        message: "Axis keys and names must be unique",
      });
    }
    for (const [axisIndex, axis] of workingCopy.axes.entries()) {
      if (
        !unique(axis.values.map((value) => value.clientKey)) ||
        !unique(axis.values.map((value) => normalized(value.name)))
      ) {
        context.addIssue({
          code: "custom",
          path: ["axes", axisIndex, "values"],
          message: "Axis value keys and names must be unique",
        });
      }
    }
    if (!unique(workingCopy.variants.map((variant) => variant.clientKey))) {
      context.addIssue({
        code: "custom",
        path: ["variants"],
        message: "Variant client keys must be unique",
      });
    }
    const combinationKeys: string[] = [];
    const usedValues = new Set<string>();
    for (const [variantIndex, variant] of workingCopy.variants.entries()) {
      const combination = new Map(
        variant.combination.map((entry) => [entry.axisClientKey, entry.valueClientKey]),
      );
      const valid =
        combination.size === workingCopy.axes.length &&
        variant.combination.length === workingCopy.axes.length &&
        workingCopy.axes.every((axis) =>
          axis.values.some(
            (value) => value.clientKey === combination.get(axis.clientKey),
          ),
        );
      if (!valid) {
        context.addIssue({
          code: "custom",
          path: ["variants", variantIndex, "combination"],
          message: "Variant combination must select one value from every axis",
        });
        continue;
      }
      const key = productCombinationKey(variant.combination);
      combinationKeys.push(key);
      for (const axis of workingCopy.axes)
        usedValues.add(`${axis.clientKey}:${combination.get(axis.clientKey)}`);
    }
    if (!unique(combinationKeys)) {
      context.addIssue({
        code: "custom",
        path: ["variants"],
        message: "Variant combinations must be unique",
      });
    }
    if (workingCopy.variants.length > 0) {
      for (const [axisIndex, axis] of workingCopy.axes.entries()) {
        for (const [valueIndex, value] of axis.values.entries()) {
          if (!usedValues.has(`${axis.clientKey}:${value.clientKey}`)) {
            context.addIssue({
              code: "custom",
              path: ["axes", axisIndex, "values", valueIndex],
              message: "Every axis value must be used by a variant",
            });
          }
        }
      }
    }
  });

export const replaceProductWorkingCopyContract = z
  .object({
    expectedRevision: z.int().nonnegative(),
    workingCopy: productWorkingCopyInputContract,
    inventory: z
      .object({
        rows: z
          .array(
            z
              .object({
                variantClientKey: clientKeyContract,
                onHand: z.int().nonnegative(),
                expectedRevision: z.int().nonnegative(),
              })
              .strict(),
          )
          .max(50),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.inventory) return;
    const keys = input.inventory.rows.map((row) => row.variantClientKey);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["inventory", "rows"],
        message: "Inventory rows must be unique",
      });
    }
    const variants = new Set(
      input.workingCopy.variants.map((variant) => variant.clientKey),
    );
    for (const [index, row] of input.inventory.rows.entries()) {
      if (!variants.has(row.variantClientKey)) {
        context.addIssue({
          code: "custom",
          path: ["inventory", "rows", index, "variantClientKey"],
          message: "Inventory row must reference a submitted variant",
        });
      }
    }
  });

const batchOfferRowContract = z
  .object({
    variantId: variantIdContract,
    price: productPriceContract,
    sku: skuContract.nullable(),
    expectedRevision: z.int().nonnegative(),
  })
  .strict();

export const replaceProductOffersBatchContract = z
  .object({
    expectedRevision: z.int().nonnegative(),
    rows: z.array(batchOfferRowContract).min(1).max(50),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.rows.map((row) => row.variantId)).size === input.rows.length,
    {
      message: "Offer rows must be unique",
      path: ["rows"],
    },
  );

export const replaceProductInventoryBatchContract = z
  .object({
    expectedRevision: z.int().nonnegative(),
    reasonCode: z.enum([
      "INITIAL_STOCK",
      "MANUAL_COUNT",
      "DAMAGED",
      "RETURNED_TO_STOCK",
      "CORRECTION",
    ]),
    rows: z
      .array(
        z
          .object({
            variantId: variantIdContract,
            onHand: z.int().nonnegative(),
            expectedRevision: z.int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.rows.map((row) => row.variantId)).size === input.rows.length,
    {
      message: "Inventory rows must be unique",
      path: ["rows"],
    },
  );

const canonicalProductVariantContract = z
  .object({
    clientKey: clientKeyContract,
    variantId: variantIdContract,
    combination: z
      .array(
        z
          .object({
            axisClientKey: clientKeyContract,
            valueClientKey: clientKeyContract,
          })
          .strict(),
      )
      .max(2),
    price: productPriceContract.nullable(),
    sku: skuContract.nullable(),
    offerRevision: z.int().nonnegative(),
  })
  .strict();

export const productViewContract = z
  .object({
    productId: productIdContract,
    state: z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED"]),
    revision: z.int().nonnegative(),
    publicationVersion: z.int().nonnegative(),
    workingCopy: z
      .object({
        name: z.string().min(2).max(120).nullable(),
        description: z.string().max(2_000),
        orderedMediaIds: z.array(mediaIdContract).max(6),
        axes: z.array(productAxisInputContract).max(2),
        variants: z.array(canonicalProductVariantContract).max(50),
      })
      .strict()
      .nullable(),
    inventory: z.array(
      z
        .object({
          variantId: variantIdContract,
          onHand: z.int().nonnegative(),
          revision: z.int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

export const sellerProductSummaryContract = z
  .object({
    productId: productIdContract,
    name: z.string().min(2).max(120).nullable(),
    primaryMediaId: mediaIdContract.nullable(),
    state: sellerProductStateContract,
    revision: z.int().nonnegative(),
    publicationVersion: z.int().nonnegative(),
  })
  .strict();

export const sellerProductListContract = z
  .object({
    items: z.array(sellerProductSummaryContract),
    nextCursor: sellerProductCursorContract.nullable(),
  })
  .strict();

export const productBatchResultContract = z
  .object({
    productRevision: z.int().nonnegative(),
    rows: z.array(
      z
        .object({
          variantId: variantIdContract,
          revision: z.int().positive(),
        })
        .strict(),
    ),
  })
  .strict();

const publicProductImageContract = z
  .object({
    id: mediaIdContract,
    url: z.string().regex(/^\/v1\/media\/[0-9a-f-]{36}$/),
  })
  .strict();

const publicProductVariantContract = z
  .object({
    variantId: variantIdContract,
    combination: z
      .array(z.object({ axis: z.string().min(1), value: z.string().min(1) }).strict())
      .max(2),
    price: productPriceContract,
    availability: z.enum(["AVAILABLE", "OUT_OF_STOCK"]),
  })
  .strict();

export const publicProductContract = z
  .object({
    productId: productIdContract,
    name: z.string().min(2).max(120),
    description: z.string().max(2_000),
    images: z.array(publicProductImageContract).min(1).max(6),
    axes: z
      .array(
        z
          .object({
            name: z.string().min(1),
            values: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      )
      .max(2),
    variants: z.array(publicProductVariantContract).min(1).max(50),
    priceRange: z
      .object({ minimum: productPriceContract, maximum: productPriceContract })
      .strict(),
    availability: z.enum(["AVAILABLE", "OUT_OF_STOCK"]),
    publicationVersion: z.int().positive(),
  })
  .strict();

export const publicProductSummaryContract = publicProductContract
  .omit({ description: true, images: true, axes: true, variants: true })
  .extend({ image: publicProductImageContract })
  .strict();

export const createSimpleProductInputContract = z.object({}).strict();

export const replaceSimpleProductWorkingCopyContract = z
  .object({
    expectedRevision: z.int().nonnegative(),
    workingCopy: z
      .object({
        name: z.string().trim().min(2).max(120).nullable(),
        description: z.string().trim().max(2_000).default(""),
        orderedMediaIds: z.array(mediaIdContract).max(1),
        variant: z
          .object({
            clientKey: z.string().min(1).max(100),
            price: productPriceContract.nullable(),
          })
          .strict(),
      })
      .strict(),
    inventory: z
      .object({
        onHand: z.int().nonnegative(),
        expectedRevision: z.int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const canonicalSimpleProductWorkingCopyContract = z
  .object({
    name: z.string().min(2).max(120),
    description: z.string().max(2_000),
    orderedMediaIds: z.array(mediaIdContract).length(1),
    variant: z
      .object({
        variantId: variantIdContract,
        price: productPriceContract,
      })
      .strict(),
  })
  .strict();

export const simpleProductDraftContract = z
  .object({
    productId: productIdContract,
    state: z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED"]),
    revision: z.int().nonnegative(),
    publicationVersion: z.int().nonnegative(),
    workingCopy: canonicalSimpleProductWorkingCopyContract,
    inventory: z
      .object({ onHand: z.int().nonnegative(), revision: z.int().nonnegative() })
      .strict(),
  })
  .strict();

export const simpleProductEmptyDraftContract = z
  .object({
    productId: productIdContract,
    state: z.literal("DRAFT"),
    revision: z.literal(0),
    publicationVersion: z.literal(0),
    workingCopy: z.null(),
    inventory: z.null(),
  })
  .strict();

export const simpleProductIncompleteDraftContract = z
  .object({
    productId: productIdContract,
    state: z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED"]),
    revision: z.int().positive(),
    publicationVersion: z.int().nonnegative(),
    workingCopy: z
      .object({
        name: z.string().min(2).max(120).nullable(),
        description: z.string().max(2_000),
        orderedMediaIds: z.array(mediaIdContract).max(1),
        variant: z
          .object({
            variantId: variantIdContract,
            price: productPriceContract.nullable(),
          })
          .strict(),
      })
      .strict(),
    inventory: z
      .object({ onHand: z.int().nonnegative(), revision: z.int().nonnegative() })
      .strict()
      .nullable(),
  })
  .strict();

export const simpleProductViewContract = z.union([
  simpleProductEmptyDraftContract,
  simpleProductIncompleteDraftContract,
  simpleProductDraftContract,
]);

export const sellerProductViewContract = z.union([
  productViewContract,
  simpleProductViewContract,
]);

export const productReadinessIssueContract = z
  .object({ path: z.string().min(1), code: z.string().min(1) })
  .strict();

export const productPreviewContract = z
  .object({
    product: productViewContract,
    ready: z.boolean(),
    issues: z.array(productReadinessIssueContract),
    projection: publicProductContract.nullable(),
  })
  .strict();

export const simpleProductPreviewContract = z
  .object({
    product: simpleProductViewContract,
    ready: z.boolean(),
    issues: z.array(productReadinessIssueContract),
  })
  .strict();

export const publishSimpleProductInputContract = z
  .object({ expectedRevision: z.int().nonnegative(), confirmed: z.literal(true) })
  .strict();

export const unpublishProductInputContract = z
  .object({
    expectedRevision: z.int().nonnegative(),
    reasonCode: z.enum([
      "SELLER_REQUEST",
      "TEMPORARILY_UNAVAILABLE",
      "NEEDS_CORRECTION",
    ]),
  })
  .strict();

export const publicSimpleProductContract = z
  .object({
    productId: productIdContract,
    variantId: variantIdContract,
    name: z.string().min(2).max(120),
    description: z.string().max(2_000),
    image: z
      .object({
        id: mediaIdContract,
        url: z.string().regex(/^\/v1\/media\/[0-9a-f-]{36}$/),
      })
      .strict(),
    price: productPriceContract,
    availability: z.enum(["AVAILABLE", "OUT_OF_STOCK"]),
    publicationVersion: z.int().positive(),
  })
  .strict();

export const publicSimpleProductSummaryContract = publicSimpleProductContract.omit({
  description: true,
  variantId: true,
});

export const publicSimpleProductListContract = z
  .object({ products: z.array(publicSimpleProductSummaryContract) })
  .strict();

export const publicProductListContract = z
  .object({
    products: z.array(
      z.union([publicSimpleProductSummaryContract, publicProductSummaryContract]),
    ),
  })
  .strict();

export const productNotFoundErrorContract = z
  .object({
    code: z.literal("PRODUCT_NOT_FOUND"),
    message: z.string().min(1),
    correlationId: z.string().min(1),
  })
  .strict();

export const productWriteConflictErrorContract = z
  .object({
    code: z.enum([
      "REVISION_CONFLICT",
      "IDEMPOTENCY_CONFLICT",
      "STORE_NOT_PUBLISHED",
      "INVALID_TRANSITION",
    ]),
    message: z.string().min(1),
    correlationId: z.string().min(1),
  })
  .strict();

export const productPreconditionRequiredErrorContract = z
  .object({
    code: z.literal("PRECONDITION_REQUIRED"),
    message: z.string().min(1),
    correlationId: z.string().min(1),
  })
  .strict();

export const sellerProductAccessInactiveErrorContract = z
  .object({
    code: z.literal("SELLER_ACCESS_INACTIVE"),
    message: z.string().min(1),
    correlationId: z.string().min(1),
  })
  .strict();

export const productPublicationEventSnapshotContract = z
  .object({
    variantIds: z.array(variantIdContract).min(1).max(50),
  })
  .strict();

export const productPublishedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("ProductPublished.v1"),
  actor: eventActorV1Contract,
  payload: z
    .object({
      storeId: storeIdContract,
      productId: productIdContract,
      publicationVersion: z.int().positive(),
      snapshot: z.union([
        publicSimpleProductSummaryContract,
        publicProductSummaryContract,
      ]),
      offerVersion: z.int().positive(),
      availabilityVersion: z.int().nonnegative(),
    })
    .strict(),
});

export const productPublishedV2Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("ProductPublished.v2"),
  actor: eventActorV1Contract,
  payload: z
    .object({
      storeId: storeIdContract,
      productId: productIdContract,
      publicationVersion: z.int().positive(),
      snapshot: productPublicationEventSnapshotContract,
      offerVersion: z.int().positive(),
      availabilityVersion: z.int().nonnegative(),
    })
    .strict(),
});

export const productUnpublishedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("ProductUnpublished.v1"),
  actor: eventActorV1Contract,
  payload: z
    .object({
      storeId: storeIdContract,
      productId: productIdContract,
      publicationVersion: z.int().positive(),
    })
    .strict(),
});

export const variantPriceChangedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("VariantPriceChanged.v1"),
  actor: eventActorV1Contract,
  payload: z
    .object({
      storeId: storeIdContract,
      productId: productIdContract,
      variantId: variantIdContract,
      publicationVersion: z.int().positive(),
      offerVersion: z.int().positive(),
      price: productPriceContract,
    })
    .strict(),
});

export const productV1Schemas = {
  ProductAuthoritativeVariantV1: productAuthoritativeVariantV1Contract,
  ProductPublishedV1: productPublishedV1Contract,
  ProductPublishedV2: productPublishedV2Contract,
  ProductUnpublishedV1: productUnpublishedV1Contract,
  VariantPriceChangedV1: variantPriceChangedV1Contract,
  ProductId: productIdContract,
  ProductIdempotencyKey: productIdempotencyKeyContract,
  ProductRevisionTag: productRevisionTagContract,
  SellerProductPageLimit: sellerProductPageLimitContract,
  SellerProductCursor: sellerProductCursorContract,
  SellerProductState: sellerProductStateContract,
  SellerProductSummary: sellerProductSummaryContract,
  SellerProductList: sellerProductListContract,
  CreateSimpleProductInput: createSimpleProductInputContract,
  ReplaceSimpleProductWorkingCopy: replaceSimpleProductWorkingCopyContract,
  SimpleProductView: simpleProductViewContract,
  SimpleProductPreview: simpleProductPreviewContract,
  PublishSimpleProductInput: publishSimpleProductInputContract,
  UnpublishProductInput: unpublishProductInputContract,
  PublicSimpleProduct: publicSimpleProductContract,
  PublicSimpleProductSummary: publicSimpleProductSummaryContract,
  PublicSimpleProductList: publicSimpleProductListContract,
  ProductNotFoundError: productNotFoundErrorContract,
  ProductWriteConflictError: productWriteConflictErrorContract,
  ProductPreconditionRequiredError: productPreconditionRequiredErrorContract,
  SellerProductAccessInactiveError: sellerProductAccessInactiveErrorContract,
  ReplaceProductWorkingCopy: replaceProductWorkingCopyContract,
  ReplaceProductOffersBatch: replaceProductOffersBatchContract,
  ReplaceProductInventoryBatch: replaceProductInventoryBatchContract,
  PublicProduct: publicProductContract,
  PublicProductSummary: publicProductSummaryContract,
  PublicProductList: publicProductListContract,
  ProductView: productViewContract,
  SellerProductView: sellerProductViewContract,
  ProductPreview: productPreviewContract,
  ProductBatchResult: productBatchResultContract,
} as const;

export function createProductV1JsonSchemas() {
  return createJsonSchemaMap(productV1Schemas);
}

export const productV1Examples = {
  ProductId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
  ProductIdempotencyKey: "product-create-01",
  ProductRevisionTag: '"0"',
  SellerProductPageLimit: 20,
  SellerProductState: "DRAFT",
  SellerProductList: { items: [], nextCursor: null },
  CreateSimpleProductInput: {},
  ReplaceSimpleProductWorkingCopy: {
    expectedRevision: 0,
    workingCopy: {
      name: "فنجان سرامیکی",
      description: "فنجان دست‌ساز مناسب نوشیدنی گرم",
      orderedMediaIds: ["807c619f-a989-4fd9-8b78-a437a07c7bc4"],
      variant: {
        clientKey: "simple",
        price: { amount: 4_500_000, currency: "IRR" },
      },
    },
    inventory: { onHand: 8, expectedRevision: 0 },
  },
  ReplaceProductWorkingCopy: {
    expectedRevision: 0,
    workingCopy: {
      name: "پیراهن روزمره",
      description: "پارچه نرم و مناسب استفاده روزانه",
      orderedMediaIds: ["807c619f-a989-4fd9-8b78-a437a07c7bc4"],
      axes: [
        {
          clientKey: "color",
          name: "رنگ",
          values: [{ clientKey: "red", name: "قرمز" }],
        },
      ],
      variants: [
        {
          clientKey: "red",
          combination: [{ axisClientKey: "color", valueClientKey: "red" }],
          price: { amount: 7_500_000, currency: "IRR" },
          sku: "SHIRT-RED",
        },
      ],
    },
    inventory: {
      rows: [{ variantClientKey: "red", onHand: 4, expectedRevision: 0 }],
    },
  },
  ReplaceProductOffersBatch: {
    expectedRevision: 1,
    rows: [
      {
        variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
        price: { amount: 7_900_000, currency: "IRR" },
        sku: "SHIRT-RED",
        expectedRevision: 1,
      },
    ],
  },
  ReplaceProductInventoryBatch: {
    expectedRevision: 2,
    reasonCode: "MANUAL_COUNT",
    rows: [
      {
        variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
        onHand: 6,
        expectedRevision: 1,
      },
    ],
  },
  PublishSimpleProductInput: { expectedRevision: 1, confirmed: true },
  UnpublishProductInput: {
    expectedRevision: 2,
    reasonCode: "SELLER_REQUEST",
  },
  ProductNotFoundError: {
    code: "PRODUCT_NOT_FOUND",
    message: "کالا پیدا نشد.",
    correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
  },
  ProductWriteConflictError: {
    code: "REVISION_CONFLICT",
    message: "کالا در جای دیگری تغییر کرده است.",
    correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
  },
  ProductPreconditionRequiredError: {
    code: "PRECONDITION_REQUIRED",
    message: "نسخه کالا و شناسه یکتای درخواست لازم است.",
    correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
  },
  SellerProductAccessInactiveError: {
    code: "SELLER_ACCESS_INACTIVE",
    message: "دسترسی فروشندگی شما فعال نیست.",
    correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
  },
} as const;

export type ReplaceSimpleProductWorkingCopy = z.infer<
  typeof replaceSimpleProductWorkingCopyContract
>;
export type SimpleProductView = z.infer<typeof simpleProductViewContract>;
export type SimpleProductDraft = z.infer<typeof simpleProductDraftContract>;
export type SimpleProductPreview = z.infer<typeof simpleProductPreviewContract>;
export type PublicSimpleProduct = z.infer<typeof publicSimpleProductContract>;
export type PublicSimpleProductSummary = z.infer<
  typeof publicSimpleProductSummaryContract
>;
export type ProductPublishedV1 = z.infer<typeof productPublishedV1Contract>;
export type ProductPublishedV2 = z.infer<typeof productPublishedV2Contract>;
export type VariantPriceChangedV1 = z.infer<typeof variantPriceChangedV1Contract>;
export type ReplaceProductWorkingCopy = z.infer<
  typeof replaceProductWorkingCopyContract
>;
export type ReplaceProductOffersBatch = z.infer<
  typeof replaceProductOffersBatchContract
>;
export type ReplaceProductInventoryBatch = z.infer<
  typeof replaceProductInventoryBatchContract
>;
export type PublicProduct = z.infer<typeof publicProductContract>;
export type PublicProductSummary = z.infer<typeof publicProductSummaryContract>;
export type ProductView = z.infer<typeof productViewContract>;
export type SellerProductSummary = z.infer<typeof sellerProductSummaryContract>;
export type SellerProductList = z.infer<typeof sellerProductListContract>;
export type ProductPreview = z.infer<typeof productPreviewContract>;
export type ProductBatchResult = z.infer<typeof productBatchResultContract>;
export type UnpublishProductInput = z.infer<typeof unpublishProductInputContract>;
export type ProductUnpublishedV1 = z.infer<typeof productUnpublishedV1Contract>;
