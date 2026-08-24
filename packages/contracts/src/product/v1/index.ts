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

const productPriceContract = moneyV1Contract.refine(
  ({ amount }) => amount > 0 && amount % 10 === 0 && Number.isSafeInteger(amount),
  "Price must be a positive safe IRR amount divisible by ten",
);

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
    state: z.enum(["DRAFT", "PUBLISHED"]),
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
    state: z.enum(["DRAFT", "PUBLISHED"]),
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

export const productReadinessIssueContract = z
  .object({ path: z.string().min(1), code: z.string().min(1) })
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

export const publicSimpleProductContract = z
  .object({
    productId: productIdContract,
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
});

export const publicSimpleProductListContract = z
  .object({ products: z.array(publicSimpleProductSummaryContract) })
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
    code: z.enum(["REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT", "STORE_NOT_PUBLISHED"]),
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

export const productPublishedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("ProductPublished.v1"),
  actor: eventActorV1Contract,
  payload: z
    .object({
      storeId: storeIdContract,
      productId: productIdContract,
      publicationVersion: z.int().positive(),
      snapshot: publicSimpleProductSummaryContract,
      offerVersion: z.int().positive(),
      availabilityVersion: z.int().nonnegative(),
    })
    .strict(),
});

export const productV1Schemas = {
  ProductId: productIdContract,
  ProductIdempotencyKey: productIdempotencyKeyContract,
  ProductRevisionTag: productRevisionTagContract,
  CreateSimpleProductInput: createSimpleProductInputContract,
  ReplaceSimpleProductWorkingCopy: replaceSimpleProductWorkingCopyContract,
  SimpleProductView: simpleProductViewContract,
  SimpleProductPreview: simpleProductPreviewContract,
  PublishSimpleProductInput: publishSimpleProductInputContract,
  PublicSimpleProduct: publicSimpleProductContract,
  PublicSimpleProductSummary: publicSimpleProductSummaryContract,
  PublicSimpleProductList: publicSimpleProductListContract,
  ProductNotFoundError: productNotFoundErrorContract,
  ProductWriteConflictError: productWriteConflictErrorContract,
  ProductPreconditionRequiredError: productPreconditionRequiredErrorContract,
} as const;

export function createProductV1JsonSchemas() {
  return createJsonSchemaMap(productV1Schemas);
}

export const productV1Examples = {
  ProductId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
  ProductIdempotencyKey: "product-create-01",
  ProductRevisionTag: '"0"',
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
  PublishSimpleProductInput: { expectedRevision: 1, confirmed: true },
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
