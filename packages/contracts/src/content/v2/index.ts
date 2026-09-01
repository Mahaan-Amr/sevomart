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
import { mediaIdContract } from "../../media-v1";
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
} as const;

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
  PublishPurchaseExperienceInputV2: publishPurchaseExperienceInputV2Contract,
  PurchaseExperience: purchaseExperienceContract,
  ContentError: contentErrorContract,
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
