import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import { mediaIdContract } from "../../media-v1";
import { orderItemIdContract } from "../../orders/v1/index";
import {
  eventEnvelopeV1Contract,
  identityIdContract,
  productIdContract,
  storeIdContract,
} from "../../platform/v1/index";

export const contentV1Operations = {
  publishSalesContent: {
    operationId: "publishSalesContent",
    method: "post",
    path: "/v1/seller/sales-content",
  },
  publishPurchaseExperience: {
    operationId: "publishPurchaseExperience",
    method: "post",
    path: "/v1/purchase-experiences",
  },
} as const;

export const contentIdContract = z.uuid().brand("ContentId");
export const purchaseExperienceIdContract = z.uuid().brand("PurchaseExperienceId");
export { orderItemIdContract };
export type { OrderItemId } from "../../orders/v1/index";
export const contentIdempotencyKeyContract = z.string().min(1).max(200);

export const contentSourceContract = z.enum(["SELLER", "VERIFIED_PURCHASE"]);
export const contentModerationStateContract = z.enum(["PUBLISHED", "HIDDEN"]);

export const salesContentMediaContract = z
  .object({
    mediaId: mediaIdContract,
    kind: z.enum(["IMAGE", "VIDEO"]),
  })
  .strict();

const uniqueProductIdsContract = z
  .array(productIdContract)
  .min(1)
  .max(10)
  .refine((productIds) => new Set(productIds).size === productIds.length, {
    message: "Linked products must be unique",
  });

const uniqueExperienceMediaIdsContract = z
  .array(mediaIdContract)
  .max(4)
  .refine((mediaIds) => new Set(mediaIds).size === mediaIds.length, {
    message: "Experience media must be unique",
  });

export const publishSalesContentInputContract = z
  .object({
    storeId: storeIdContract,
    media: salesContentMediaContract,
    productIds: uniqueProductIdsContract,
  })
  .strict();

export const salesContentContract = z
  .object({
    contentId: contentIdContract,
    source: z.literal("SELLER"),
    moderationState: contentModerationStateContract,
  })
  .strict();

export const salesContentProductEligibilityDecisionContract = z.discriminatedUnion(
  "eligible",
  [
    z
      .object({
        eligible: z.literal(true),
        storeId: storeIdContract,
        products: z
          .array(
            z
              .object({
                storeId: storeIdContract,
                productId: productIdContract,
                publicationVersion: z.int().positive(),
                publicationStatus: z.literal("PUBLISHED"),
              })
              .strict(),
          )
          .min(1)
          .max(10),
      })
      .strict()
      .refine(
        ({ storeId, products }) =>
          products.every((product) => product.storeId === storeId) &&
          new Set(products.map((product) => product.productId)).size ===
            products.length,
        {
          message: "Every unique active product must belong to the content store",
          path: ["products"],
        },
      ),
    z
      .object({
        eligible: z.literal(false),
        reason: z.enum(["NO_ACTIVE_PRODUCT", "FORBIDDEN"]),
      })
      .strict(),
  ],
);

export const purchaseExperienceEligibilityDecisionContract = z.discriminatedUnion(
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
        fulfillmentStatus: z.literal("DELIVERED"),
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

export const publishPurchaseExperienceInputContract = z
  .object({
    buyerId: identityIdContract,
    orderItemId: orderItemIdContract,
    rating: z.int().min(1).max(5),
    text: z.string().trim().max(2_000),
    mediaIds: uniqueExperienceMediaIdsContract,
  })
  .strict();

export const purchaseExperienceContract = z
  .object({
    experienceId: purchaseExperienceIdContract,
    source: z.literal("VERIFIED_PURCHASE"),
    moderationState: contentModerationStateContract,
  })
  .strict();

export const contentErrorContract = z
  .object({
    code: z.enum([
      "NO_ACTIVE_PRODUCT",
      "FORBIDDEN",
      "NOT_ELIGIBLE",
      "ALREADY_SUBMITTED",
      "IDEMPOTENCY_CONFLICT",
      "IDEMPOTENCY_IN_PROGRESS",
      "PRECONDITION_REQUIRED",
    ]),
    message: z.string().min(1),
    correlationId: z.uuid(),
  })
  .strict();

export const salesContentPublishedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("SalesContentPublished.v1"),
  actor: z.object({ type: z.literal("SYSTEM") }).strict(),
  payload: z
    .object({
      contentId: contentIdContract,
      source: z.literal("SELLER"),
      storeId: storeIdContract,
      media: salesContentMediaContract,
      productIds: uniqueProductIdsContract,
      moderationState: z.literal("PUBLISHED"),
    })
    .strict(),
});

export const purchaseExperiencePublishedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("PurchaseExperiencePublished.v1"),
  actor: z.object({ type: z.literal("SYSTEM") }).strict(),
  payload: z
    .object({
      experienceId: purchaseExperienceIdContract,
      source: z.literal("VERIFIED_PURCHASE"),
      storeId: storeIdContract,
      productId: productIdContract,
      rating: z.int().min(1).max(5),
      text: z.string().max(2_000),
      mediaIds: uniqueExperienceMediaIdsContract,
      moderationState: z.literal("PUBLISHED"),
    })
    .strict(),
});

export const contentV1Schemas = {
  ContentId: contentIdContract,
  PurchaseExperienceId: purchaseExperienceIdContract,
  ContentIdempotencyKey: contentIdempotencyKeyContract,
  ContentSource: contentSourceContract,
  ContentModerationState: contentModerationStateContract,
  SalesContentMedia: salesContentMediaContract,
  PublishSalesContentInput: publishSalesContentInputContract,
  SalesContent: salesContentContract,
  SalesContentProductEligibilityDecision:
    salesContentProductEligibilityDecisionContract,
  PurchaseExperienceEligibilityDecision: purchaseExperienceEligibilityDecisionContract,
  PublishPurchaseExperienceInput: publishPurchaseExperienceInputContract,
  PurchaseExperience: purchaseExperienceContract,
  ContentError: contentErrorContract,
  SalesContentPublishedV1: salesContentPublishedV1Contract,
  PurchaseExperiencePublishedV1: purchaseExperiencePublishedV1Contract,
} as const;

export function createContentV1JsonSchemas() {
  return createJsonSchemaMap(contentV1Schemas);
}

export const contentV1Examples = {
  ContentId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
  PurchaseExperienceId: "61fe87eb-6c0f-47ca-93ca-9f9a038ca270",
  ContentIdempotencyKey: "publish-content-01",
  PublishSalesContentInput: {
    storeId: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
    media: {
      mediaId: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
      kind: "IMAGE",
    },
    productIds: ["a78fdcc0-caad-4315-a7cd-b22834fe76d4"],
  },
  SalesContent: {
    contentId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
    source: "SELLER",
    moderationState: "PUBLISHED",
  },
  PublishPurchaseExperienceInput: {
    buyerId: "97554510-44c2-4e02-b44f-95c17ff239de",
    orderItemId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    rating: 5,
    text: "بسته‌بندی مرتب بود و کالا مطابق تصویر رسید.",
    mediaIds: ["807c619f-a989-4fd9-8b78-a437a07c7bc4"],
  },
  PurchaseExperience: {
    experienceId: "61fe87eb-6c0f-47ca-93ca-9f9a038ca270",
    source: "VERIFIED_PURCHASE",
    moderationState: "PUBLISHED",
  },
  ContentError: {
    code: "NOT_ELIGIBLE",
    message: "برای این کالا خرید تأییدشده‌ای پیدا نشد.",
    correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
  },
} as const;

export type ContentId = z.infer<typeof contentIdContract>;
export type PurchaseExperienceId = z.infer<typeof purchaseExperienceIdContract>;
export type ContentSource = z.infer<typeof contentSourceContract>;
export type ContentModerationState = z.infer<typeof contentModerationStateContract>;
export type PublishSalesContentInput = z.infer<typeof publishSalesContentInputContract>;
export type SalesContent = z.infer<typeof salesContentContract>;
export type SalesContentProductEligibilityDecision = z.infer<
  typeof salesContentProductEligibilityDecisionContract
>;
export type PurchaseExperienceEligibilityDecision = z.infer<
  typeof purchaseExperienceEligibilityDecisionContract
>;
export type PublishPurchaseExperienceInput = z.infer<
  typeof publishPurchaseExperienceInputContract
>;
export type PurchaseExperience = z.infer<typeof purchaseExperienceContract>;
export type ContentError = z.infer<typeof contentErrorContract>;
export type SalesContentPublishedV1 = z.infer<typeof salesContentPublishedV1Contract>;
export type PurchaseExperiencePublishedV1 = z.infer<
  typeof purchaseExperiencePublishedV1Contract
>;
