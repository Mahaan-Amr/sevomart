import {
  contentV1Operations,
  publishPurchaseExperienceInputContract,
  publishSalesContentInputContract,
  purchaseExperienceEligibilityDecisionContract,
  purchaseExperiencePublishedV1Contract,
  salesContentProductEligibilityDecisionContract,
  salesContentPublishedV1Contract,
} from "@sevo/contracts/content/v1";
import { orderItemIdContract as ordersOrderItemIdContract } from "@sevo/contracts/orders/v1";
import { describe, expect, it } from "vitest";

const ids = {
  buyer: "97554510-44c2-4e02-b44f-95c17ff239de",
  seller: "87554510-44c2-4e02-b44f-95c17ff239de",
  store: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
  product: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
  secondProduct: "b78fdcc0-caad-4315-a7cd-b22834fe76d4",
  orderItem: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
  media: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
  content: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
  event: "78ee2a86-221f-4a73-b320-2fd315585c05",
  correlation: "7609f906-c921-490c-a793-84398fb67e0c",
};

const envelope = {
  version: 1 as const,
  eventId: ids.event,
  aggregateId: ids.content,
  aggregateVersion: 1,
  occurredAt: "2026-08-27T10:00:00.000Z",
  correlationId: ids.correlation,
};

describe("content v1 contract", () => {
  it("requires sales content to name at least one unique product", () => {
    const input = {
      storeId: ids.store,
      media: { mediaId: ids.media, kind: "IMAGE" },
      productIds: [ids.product, ids.secondProduct],
    } as const;

    expect(publishSalesContentInputContract.parse(input)).toEqual(input);
    for (const invalid of [
      { ...input, productIds: [] },
      { ...input, productIds: [ids.product, ids.product] },
      { ...input, source: "VERIFIED_PURCHASE" },
    ]) {
      expect(publishSalesContentInputContract.safeParse(invalid).success).toBe(false);
    }
    expect(
      publishSalesContentInputContract.parse({
        ...input,
        media: { ...input.media, kind: "VIDEO" },
      }).media.kind,
    ).toBe("VIDEO");

    expect(
      salesContentProductEligibilityDecisionContract.parse({
        eligible: true,
        storeId: ids.store,
        products: [
          {
            storeId: ids.store,
            productId: ids.product,
            publicationVersion: 2,
            publicationStatus: "PUBLISHED",
          },
        ],
      }).eligible,
    ).toBe(true);
    expect(
      salesContentProductEligibilityDecisionContract.safeParse({
        eligible: true,
        storeId: ids.store,
        products: [
          {
            storeId: "cd75d73c-1744-422c-a6ae-31195ed6abf1",
            productId: ids.product,
            publicationVersion: 2,
            publicationStatus: "PUBLISHED",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("makes confirmed-purchase eligibility and one-submission rejection explicit", () => {
    const eligible = {
      eligible: true,
      buyerId: ids.buyer,
      orderItemId: ids.orderItem,
      storeId: ids.store,
      productId: ids.product,
      purchaseStatus: "CONFIRMED",
      fulfillmentStatus: "DELIVERED",
    } as const;
    expect(purchaseExperienceEligibilityDecisionContract.parse(eligible)).toEqual(
      eligible,
    );
    const withoutFulfillment: Record<string, unknown> = { ...eligible };
    delete withoutFulfillment.fulfillmentStatus;
    expect(
      purchaseExperienceEligibilityDecisionContract.safeParse(withoutFulfillment)
        .success,
    ).toBe(false);
    expect(
      purchaseExperienceEligibilityDecisionContract.parse({
        eligible: false,
        reason: "ALREADY_SUBMITTED",
      }),
    ).toEqual({ eligible: false, reason: "ALREADY_SUBMITTED" });
    expect(
      purchaseExperienceEligibilityDecisionContract.safeParse({
        ...eligible,
        purchaseStatus: "PENDING",
      }).success,
    ).toBe(false);
    const input = {
      buyerId: ids.buyer,
      orderItemId: ids.orderItem,
      rating: 5,
      text: "بسته‌بندی مرتب بود و کالا مطابق تصویر رسید.",
      mediaIds: [ids.media],
    } as const;
    expect(publishPurchaseExperienceInputContract.parse(input)).toEqual(input);
    expect(
      publishPurchaseExperienceInputContract.safeParse({ ...input, rating: 6 }).success,
    ).toBe(false);
  });

  it("re-exports the Orders-owned order item identifier seam", async () => {
    const { orderItemIdContract } = await import("@sevo/contracts/content/v1");

    const ownerValue = ordersOrderItemIdContract.parse(ids.orderItem);
    expect(orderItemIdContract.parse(ownerValue)).toBe(ownerValue);
    expect(orderItemIdContract.safeParse("not-an-order-item").success).toBe(false);
  });

  it("keeps seller content and verified purchase experience distinct in events", () => {
    const salesEvent = salesContentPublishedV1Contract.parse({
      ...envelope,
      eventType: "SalesContentPublished.v1",
      actor: { type: "SYSTEM" },
      payload: {
        contentId: ids.content,
        source: "SELLER",
        storeId: ids.store,
        media: { mediaId: ids.media, kind: "IMAGE" },
        productIds: [ids.product],
        moderationState: "PUBLISHED",
      },
    });
    const experienceEvent = purchaseExperiencePublishedV1Contract.parse({
      ...envelope,
      eventType: "PurchaseExperiencePublished.v1",
      actor: { type: "SYSTEM" },
      payload: {
        experienceId: ids.content,
        source: "VERIFIED_PURCHASE",
        storeId: ids.store,
        productId: ids.product,
        rating: 5,
        text: "بسته‌بندی مرتب بود.",
        mediaIds: [ids.media],
        moderationState: "PUBLISHED",
      },
    });

    expect([salesEvent.payload.source, experienceEvent.payload.source]).toEqual([
      "SELLER",
      "VERIFIED_PURCHASE",
    ]);
    expect(
      salesContentPublishedV1Contract.safeParse({
        ...salesEvent,
        payload: { ...salesEvent.payload, source: "VERIFIED_PURCHASE" },
      }).success,
    ).toBe(false);
    expect(experienceEvent.payload).not.toHaveProperty("buyerId");
    expect(experienceEvent.payload).not.toHaveProperty("orderItemId");
    expect(experienceEvent.actor).toEqual({ type: "SYSTEM" });
  });

  it("pins the two publishing operation paths", () => {
    expect(contentV1Operations).toEqual({
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
    });
  });
});
