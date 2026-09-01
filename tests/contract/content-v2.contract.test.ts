import {
  contentV2Operations,
  createPurchaseExperienceMediaContextInputContract,
  productPurchaseExperiencesContract,
  purchaseExperienceMediaContextContract,
  contentErrorV2Contract,
  publicSalesContentFeedV2Contract,
  publicSalesContentStoreIdsV2Contract,
  publishPurchaseExperienceInputV2Contract,
  publishSalesContentInputV2Contract,
  purchaseExperienceEligibilityDecisionV2Contract,
} from "@sevo/contracts/content/v2";
import { describe, expect, it } from "vitest";
import { contentErrorContract } from "@sevo/contracts/content/v1";

const ids = {
  buyer: "97554510-44c2-4e02-b44f-95c17ff239de",
  store: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
  product: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
  orderItem: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
  media: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
};

describe("content v2 contract", () => {
  it("publishes the executable image-only sales-content input", () => {
    const input = {
      storeId: ids.store,
      media: { mediaId: ids.media, kind: "IMAGE" },
      productIds: [ids.product],
    } as const;

    expect(publishSalesContentInputV2Contract.parse(input)).toEqual(input);
    expect(
      publishSalesContentInputV2Contract.safeParse({
        ...input,
        media: { ...input.media, kind: "VIDEO" },
      }).success,
    ).toBe(false);
  });

  it("uses confirmed-order eligibility without claiming fulfillment", () => {
    const decision = {
      eligible: true,
      buyerId: ids.buyer,
      orderItemId: ids.orderItem,
      storeId: ids.store,
      productId: ids.product,
      purchaseStatus: "CONFIRMED",
    } as const;

    expect(purchaseExperienceEligibilityDecisionV2Contract.parse(decision)).toEqual(
      decision,
    );
    expect(
      publishPurchaseExperienceInputV2Contract.parse({
        buyerId: ids.buyer,
        orderItemId: ids.orderItem,
        rating: 5,
        text: "کالا مطابق تصویر بود.",
        mediaIds: [ids.media],
      }).orderItemId,
    ).toBe(ids.orderItem);
  });

  it("uses distinct v2 publishing paths and operation identifiers", () => {
    expect(contentV2Operations).toEqual({
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
    });
  });

  it("withholds a public average until three verified rated purchases exist", () => {
    const base = {
      productId: ids.product,
      experiences: [
        {
          experienceId: "61fe87eb-6c0f-47ca-93ca-9f9a038ca270",
          source: "VERIFIED_PURCHASE",
          moderationState: "PUBLISHED",
          rating: 5,
          text: "کالا مطابق تصویر بود.",
          mediaIds: [ids.media],
          createdAt: "2026-09-01T08:30:00.000Z",
        },
      ],
    } as const;

    expect(
      productPurchaseExperiencesContract.parse({
        ...base,
        summary: { verifiedPurchaseCount: 1, averageRating: null },
      }).summary,
    ).toEqual({ verifiedPurchaseCount: 1, averageRating: null });
    expect(
      productPurchaseExperiencesContract.safeParse({
        ...base,
        summary: { verifiedPurchaseCount: 1, averageRating: 5 },
      }).success,
    ).toBe(false);
    expect(
      productPurchaseExperiencesContract.parse({
        ...base,
        summary: { verifiedPurchaseCount: 3, averageRating: 4.3 },
      }).summary.averageRating,
    ).toBe(4.3);
  });

  it("returns an opaque media context without exposing the order item", () => {
    expect(
      createPurchaseExperienceMediaContextInputContract.parse({
        orderItemId: ids.orderItem,
      }),
    ).toEqual({ orderItemId: ids.orderItem });
    const context = purchaseExperienceMediaContextContract.parse({
      contextId: "70000000-0000-4000-8000-000000000001",
      expiresAt: "2026-09-01T12:30:00.000Z",
      maxItems: 4,
      maxBytesPerItem: 10 * 1024 * 1024,
      uploadUrl: "/v1/purchase-experience-media/70000000-0000-4000-8000-000000000001",
    });
    expect(context).not.toHaveProperty("orderItemId");
    expect(context.uploadUrl).not.toContain(ids.orderItem);
  });

  it("publishes a privacy-safe sales-content projection for visible stores", () => {
    expect(publicSalesContentStoreIdsV2Contract.parse(ids.store)).toEqual([ids.store]);
    expect(
      publicSalesContentFeedV2Contract.parse({
        projectionUpdatedAt: "2026-09-01T10:00:00.000Z",
        items: [
          {
            contentId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
            source: "SELLER",
            storeId: ids.store,
            media: { mediaId: ids.media, kind: "VIDEO" },
            products: [{ productId: ids.product, active: false }],
            publishedAt: "2026-09-01T09:00:00.000Z",
          },
        ],
      }),
    ).toMatchObject({
      items: [
        {
          source: "SELLER",
          products: [{ productId: ids.product, active: false }],
        },
      ],
    });
  });

  it("rejects private or popularity fields from the public projection", () => {
    expect(
      publicSalesContentFeedV2Contract.safeParse({
        projectionUpdatedAt: "2026-09-01T10:00:00.000Z",
        items: [
          {
            contentId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
            source: "SELLER",
            storeId: ids.store,
            media: { mediaId: ids.media, kind: "IMAGE" },
            products: [{ productId: ids.product, active: true }],
            publishedAt: "2026-09-01T09:00:00.000Z",
            actorIdentityId: ids.buyer,
            viewCount: 12,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("adds the public-query error only to the v2 contract", () => {
    const error = {
      code: "INVALID_QUERY",
      message: "شناسه فروشگاه‌ها را درست وارد کنید.",
      correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
    } as const;

    expect(contentErrorV2Contract.parse(error)).toEqual(error);
    expect(contentErrorContract.safeParse(error).success).toBe(false);
  });
});
