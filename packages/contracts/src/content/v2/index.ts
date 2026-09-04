import { z } from "zod";

import {
  contentErrorContract,
  contentIdContract,
  contentIdempotencyKeyContract,
  contentModerationStateContract,
  contentSourceContract,
  publishPurchaseExperienceInputContract,
  publishSalesContentInputContract,
  purchaseExperienceContract,
  purchaseExperienceIdContract,
  purchaseExperiencePublishedV1Contract,
  salesContentContract,
  salesContentProductEligibilityDecisionContract,
  salesContentPublishedV1Contract,
} from "../v1/index";
import { createJsonSchemaMap } from "../../json-schema";
import {
  MEDIA_UPLOAD_MAX_BYTES,
  PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS,
  mediaIdContract,
  purchaseExperienceMediaContextIdContract,
} from "../../media-v1";
import { orderItemIdContract } from "../../orders/v1/index";
import {
  identityIdContract,
  productIdContract,
  storeIdContract,
} from "../../platform/v1/index";

export const contentV2Operations = {
  publishSalesContent: {
    operationId: "publishSalesContentV2",
    method: "post",
    path: "/v2/seller/sales-content",
  },
  publishPurchaseExperience: {
    operationId: "publishPurchaseExperienceV2",
    method: "post",
    path: "/v2/purchase-experiences",
  },
  readPurchaseExperienceEligibility: {
    operationId: "readPurchaseExperienceEligibilityV2",
    method: "get",
    path: "/v2/purchase-experiences/eligibility/{orderItemId}",
  },
  readProductPurchaseExperiences: {
    operationId: "readProductPurchaseExperiencesV2",
    method: "get",
    path: "/v2/products/{productId}/purchase-experiences",
  },
  createPurchaseExperienceMediaContext: {
    operationId: "createPurchaseExperienceMediaContextV2",
    method: "post",
    path: "/v2/purchase-experiences/media-contexts",
  },
  readPublicSalesContent: {
    operationId: "readPublicSalesContentV2",
    method: "get",
    path: "/v2/sales-content",
  },
} as const;

export const createPurchaseExperienceMediaContextInputContract = z
  .object({ orderItemId: orderItemIdContract })
  .strict();
export const purchaseExperienceMediaContextContract = z
  .object({
    contextId: purchaseExperienceMediaContextIdContract,
    expiresAt: z.iso.datetime(),
    maxItems: z.literal(PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS),
    maxBytesPerItem: z.literal(MEDIA_UPLOAD_MAX_BYTES),
    uploadUrl: z.string().regex(/^\/v1\/purchase-experience-media\/[0-9a-f-]{36}$/),
  })
  .strict();

export const salesContentMediaV2Contract = z
  .object({
    mediaId: mediaIdContract,
    kind: z.literal("IMAGE"),
  })
  .strict();

export const publishSalesContentInputV2Contract =
  publishSalesContentInputContract.extend({ media: salesContentMediaV2Contract });

export const purchaseExperienceEligibilityDecisionV2Contract = z.discriminatedUnion(
  "eligible",
  [
    z
      .object({
        eligible: z.literal(true),
        buyerId: identityIdContract,
        orderItemId: orderItemIdContract,
        storeId: storeIdContract,
        productId: productIdContract,
        purchaseStatus: z.literal("CONFIRMED"),
      })
      .strict(),
    z
      .object({
        eligible: z.literal(false),
        reason: z.enum(["NOT_ELIGIBLE", "ALREADY_SUBMITTED"]),
      })
      .strict(),
  ],
);

export const publishPurchaseExperienceInputV2Contract =
  publishPurchaseExperienceInputContract;

export const publicPurchaseExperienceContract = z
  .object({
    experienceId: purchaseExperienceIdContract,
    source: z.literal("VERIFIED_PURCHASE"),
    moderationState: z.literal("PUBLISHED"),
    rating: z.int().min(1).max(5),
    text: z.string().max(2_000),
    mediaIds: z.array(mediaIdContract).max(4),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const purchaseExperienceSummaryContract = z
  .object({
    verifiedPurchaseCount: z.int().nonnegative(),
    averageRating: z.number().min(1).max(5).nullable(),
  })
  .strict()
  .refine(
    ({ verifiedPurchaseCount, averageRating }) =>
      verifiedPurchaseCount >= 3 ? averageRating !== null : averageRating === null,
    { message: "Average rating requires at least three verified purchases" },
  );

export const productPurchaseExperiencesContract = z
  .object({
    productId: productIdContract,
    summary: purchaseExperienceSummaryContract,
    experiences: z.array(publicPurchaseExperienceContract).max(20),
  })
  .strict();

export const publicSalesContentStoreIdsV2ParameterContract = z.string().min(1).max(700);

export const publicSalesContentStoreIdsV2Contract =
  publicSalesContentStoreIdsV2ParameterContract
    .transform((value) => value.split(","))
    .pipe(z.array(storeIdContract).min(1).max(18))
    .refine((storeIds) => new Set(storeIds).size === storeIds.length, {
      message: "Store ids must be unique",
    });

export const publicSalesContentProductV2Contract = z
  .object({
    productId: productIdContract,
    active: z.boolean(),
  })
  .strict();

export const publicSalesContentItemV2Contract = z
  .object({
    contentId: contentIdContract,
    source: z.literal("SELLER"),
    storeId: storeIdContract,
    media: z
      .object({
        mediaId: mediaIdContract,
        kind: z.enum(["IMAGE", "VIDEO"]),
      })
      .strict(),
    products: z.array(publicSalesContentProductV2Contract).min(1).max(10),
    publishedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const publicSalesContentFeedV2Contract = z
  .object({
    projectionUpdatedAt: z.iso.datetime({ offset: true }),
    items: z.array(publicSalesContentItemV2Contract).max(60),
  })
  .strict();

export const contentErrorV2Contract = z.union([
  contentErrorContract,
  z
    .object({
      code: z.literal("INVALID_QUERY"),
      message: z.string().min(1),
      correlationId: z.uuid(),
    })
    .strict(),
]);

export const contentV2Schemas = {
  ContentId: contentIdContract,
  PurchaseExperienceId: purchaseExperienceIdContract,
  ContentIdempotencyKey: contentIdempotencyKeyContract,
  ContentSource: contentSourceContract,
  ContentModerationState: contentModerationStateContract,
  SalesContentMediaV2: salesContentMediaV2Contract,
  PublishSalesContentInputV2: publishSalesContentInputV2Contract,
  SalesContent: salesContentContract,
  SalesContentProductEligibilityDecision:
    salesContentProductEligibilityDecisionContract,
  PurchaseExperienceEligibilityDecisionV2:
    purchaseExperienceEligibilityDecisionV2Contract,
  CreatePurchaseExperienceMediaContextInput:
    createPurchaseExperienceMediaContextInputContract,
  PurchaseExperienceMediaContext: purchaseExperienceMediaContextContract,
  PublishPurchaseExperienceInputV2: publishPurchaseExperienceInputV2Contract,
  PublicPurchaseExperience: publicPurchaseExperienceContract,
  PurchaseExperienceSummary: purchaseExperienceSummaryContract,
  ProductPurchaseExperiences: productPurchaseExperiencesContract,
  PublicSalesContentStoreIdsV2: publicSalesContentStoreIdsV2ParameterContract,
  PublicSalesContentProductV2: publicSalesContentProductV2Contract,
  PublicSalesContentItemV2: publicSalesContentItemV2Contract,
  PublicSalesContentFeedV2: publicSalesContentFeedV2Contract,
  PurchaseExperience: purchaseExperienceContract,
  ContentError: contentErrorContract,
  ContentErrorV2: contentErrorV2Contract,
  SalesContentPublishedV1: salesContentPublishedV1Contract,
  PurchaseExperiencePublishedV1: purchaseExperiencePublishedV1Contract,
} as const;

export function createContentV2JsonSchemas() {
  return createJsonSchemaMap(contentV2Schemas);
}

export const contentV2Examples = {
  PublishSalesContentInputV2: {
    storeId: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
    media: {
      mediaId: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
      kind: "IMAGE",
    },
    productIds: ["a78fdcc0-caad-4315-a7cd-b22834fe76d4"],
  },
  PublishPurchaseExperienceInputV2: {
    buyerId: "97554510-44c2-4e02-b44f-95c17ff239de",
    orderItemId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    rating: 5,
    text: "بسته‌بندی مرتب بود و کالا مطابق تصویر رسید.",
    mediaIds: ["807c619f-a989-4fd9-8b78-a437a07c7bc4"],
  },
  ProductPurchaseExperiences: {
    productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
    summary: { verifiedPurchaseCount: 3, averageRating: 4.7 },
    experiences: [
      {
        experienceId: "61fe87eb-6c0f-47ca-93ca-9f9a038ca270",
        source: "VERIFIED_PURCHASE",
        moderationState: "PUBLISHED",
        rating: 5,
        text: "بسته‌بندی مرتب بود و کالا مطابق تصویر رسید.",
        mediaIds: ["807c619f-a989-4fd9-8b78-a437a07c7bc4"],
        createdAt: "2026-09-01T08:30:00.000Z",
      },
    ],
  },
  CreatePurchaseExperienceMediaContextInput: {
    orderItemId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
  },
  PurchaseExperienceMediaContext: {
    contextId: "70000000-0000-4000-8000-000000000001",
    expiresAt: "2026-09-01T12:30:00.000Z",
    maxItems: PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS,
    maxBytesPerItem: MEDIA_UPLOAD_MAX_BYTES,
    uploadUrl: "/v1/purchase-experience-media/70000000-0000-4000-8000-000000000001",
  },
  PublicSalesContentStoreIdsV2: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
  PublicSalesContentFeedV2: {
    projectionUpdatedAt: "2026-09-01T10:00:00.000Z",
    items: [
      {
        contentId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
        source: "SELLER",
        storeId: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
        media: {
          mediaId: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
          kind: "IMAGE",
        },
        products: [
          {
            productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
            active: true,
          },
        ],
        publishedAt: "2026-09-01T09:00:00.000Z",
      },
    ],
  },
} as const;

export {
  contentErrorContract,
  contentIdContract,
  contentIdempotencyKeyContract,
  contentModerationStateContract,
  contentSourceContract,
  orderItemIdContract,
  purchaseExperienceContract,
  purchaseExperienceIdContract,
  purchaseExperiencePublishedV1Contract,
  salesContentContract,
  salesContentProductEligibilityDecisionContract,
  salesContentPublishedV1Contract,
};
export type {
  ContentError,
  ContentId,
  ContentModerationState,
  ContentSource,
  PurchaseExperience,
  PurchaseExperienceId,
  PurchaseExperiencePublishedV1,
  SalesContent,
  SalesContentProductEligibilityDecision,
  SalesContentPublishedV1,
} from "../v1/index";
export type { OrderItemId } from "../../orders/v1/index";

export type PublishSalesContentInputV2 = z.infer<
  typeof publishSalesContentInputV2Contract
>;
export type PurchaseExperienceEligibilityDecisionV2 = z.infer<
  typeof purchaseExperienceEligibilityDecisionV2Contract
>;
export type PublishPurchaseExperienceInputV2 = z.infer<
  typeof publishPurchaseExperienceInputV2Contract
>;
export type PublicPurchaseExperience = z.infer<typeof publicPurchaseExperienceContract>;
export type PurchaseExperienceSummary = z.infer<
  typeof purchaseExperienceSummaryContract
>;
export type ProductPurchaseExperiences = z.infer<
  typeof productPurchaseExperiencesContract
>;
export type CreatePurchaseExperienceMediaContextInput = z.infer<
  typeof createPurchaseExperienceMediaContextInputContract
>;
export type PurchaseExperienceMediaContext = z.infer<
  typeof purchaseExperienceMediaContextContract
>;
export type PublicSalesContentProductV2 = z.infer<
  typeof publicSalesContentProductV2Contract
>;
export type PublicSalesContentItemV2 = z.infer<typeof publicSalesContentItemV2Contract>;
export type PublicSalesContentFeedV2 = z.infer<typeof publicSalesContentFeedV2Contract>;
export type ContentErrorV2 = z.infer<typeof contentErrorV2Contract>;
