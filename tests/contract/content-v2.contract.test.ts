import {
  contentV2Operations,
  publishPurchaseExperienceInputV2Contract,
  publishSalesContentInputV2Contract,
  purchaseExperienceEligibilityDecisionV2Contract,
} from "@sevo/contracts/content/v2";
import { describe, expect, it } from "vitest";

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
    });
  });
});
