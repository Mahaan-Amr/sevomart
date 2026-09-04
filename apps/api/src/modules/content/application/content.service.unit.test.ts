import { randomUUID } from "node:crypto";

import {
  contentIdContract,
  purchaseExperienceIdContract,
} from "@sevo/contracts/content/v1";
import { purchaseExperienceMediaContextContract } from "@sevo/contracts/content/v2";
import {
  identityIdContract,
  productIdContract,
  storeIdContract,
} from "@sevo/contracts/platform/v1";
import { mediaIdContract } from "@sevo/contracts/media/v1";
import { describe, expect, it } from "vitest";

import { StoreOwnershipRequiredError } from "../../store/public";
import {
  type ContentMediaRead,
  type ContentRepository,
  type PurchaseEligibilityRead,
} from "../public";
import { ContentService } from "./content.service";

const ids = {
  buyer: identityIdContract.parse("10000000-0000-4000-8000-000000000001"),
  seller: identityIdContract.parse("10000000-0000-4000-8000-000000000002"),
  store: storeIdContract.parse("20000000-0000-4000-8000-000000000001"),
  product: productIdContract.parse("30000000-0000-4000-8000-000000000001"),
  media: mediaIdContract.parse("40000000-0000-4000-8000-000000000001"),
  orderItem: "50000000-0000-4000-8000-000000000001",
};

function fixture(
  overrides: {
    productPublished?: boolean;
    purchaseEligible?: boolean;
    storeFailure?: Error;
    replaySales?: boolean;
    replayPurchase?: boolean;
    existingExperience?: boolean;
  } = {},
) {
  const writes: unknown[] = [];
  const repository: ContentRepository = {
    async hasPurchaseExperience() {
      return overrides.existingExperience ?? false;
    },
    async replaySalesContent() {
      return overrides.replaySales
        ? {
            contentId: contentIdContract.parse(randomUUID()),
            source: "SELLER",
            moderationState: "PUBLISHED",
          }
        : undefined;
    },
    async replayPurchaseExperience() {
      return overrides.replayPurchase
        ? {
            experienceId: purchaseExperienceIdContract.parse(randomUUID()),
            source: "VERIFIED_PURCHASE",
            moderationState: "PUBLISHED",
          }
        : undefined;
    },
    async publishSalesContent(command) {
      writes.push(command);
      return {
        contentId: contentIdContract.parse(randomUUID()),
        source: "SELLER",
        moderationState: "PUBLISHED",
      };
    },
    async publishPurchaseExperience(command) {
      writes.push(command);
      return {
        experienceId: purchaseExperienceIdContract.parse(randomUUID()),
        source: "VERIFIED_PURCHASE",
        moderationState: "PUBLISHED",
      };
    },
    async readProductPurchaseExperiences(productId) {
      return {
        productId,
        summary: { verifiedPurchaseCount: 2, averageRating: null },
        experiences: [],
      };
    },
    async readPublicSalesContent() {
      return {
        projectionUpdatedAt: "2026-09-01T10:00:00.000Z",
        items: [],
      };
    },
  };
  const sessions = {
    async readActiveIdentitySession(token: string) {
      return token === "seller"
        ? { identityId: ids.seller, expiresAt: new Date(Date.now() + 60_000) }
        : token === "buyer"
          ? { identityId: ids.buyer, expiresAt: new Date(Date.now() + 60_000) }
          : undefined;
    },
    async readIdentitySession() {
      return undefined;
    },
  };
  const products = {
    async readPublishedProduct(
      productId: typeof ids.product,
      storeId: typeof ids.store,
    ) {
      if (overrides.productPublished === false) return undefined;
      return { productId, storeId, publicationVersion: 3 };
    },
    async readPublished() {
      return undefined;
    },
    async readAuthoritativeVariant() {
      return undefined;
    },
  };
  const media: ContentMediaRead = {
    async readOwnedKind(mediaId, identityId) {
      return mediaId === ids.media && [ids.seller, ids.buyer].includes(identityId)
        ? "IMAGE"
        : undefined;
    },
    async issuePurchaseExperienceUploadContext(input) {
      void input;
      return purchaseExperienceMediaContextContract.parse({
        contextId: "70000000-0000-4000-8000-000000000001",
        expiresAt: "2026-09-01T12:30:00.000Z",
        maxItems: 4,
        maxBytesPerItem: 10 * 1024 * 1024,
        uploadUrl: "/v1/purchase-experience-media/70000000-0000-4000-8000-000000000001",
      });
    },
    async arePurchaseExperienceImagesReady(input) {
      return (
        input.identityId === ids.buyer &&
        input.orderItemId === ids.orderItem &&
        input.mediaIds.every((mediaId) => mediaId === ids.media)
      );
    },
  };
  const purchases: PurchaseEligibilityRead = {
    async readEligibility(input) {
      return overrides.purchaseEligible === false
        ? { eligible: false, reason: "NOT_ELIGIBLE" }
        : {
            eligible: true,
            buyerId: input.buyerId,
            orderItemId: input.orderItemId,
            storeId: ids.store,
            productId: ids.product,
            purchaseStatus: "CONFIRMED",
          };
    },
  };
  const service = new ContentService(
    repository,
    sessions,
    {
      async isActiveSeller(identityId) {
        return identityId === ids.seller;
      },
    },
    {
      async requireOwnedSellable(identityId, storeId) {
        if (overrides.storeFailure) throw overrides.storeFailure;
        if (identityId !== ids.seller || storeId !== ids.store)
          throw new StoreOwnershipRequiredError(storeId);
        return { storeId, publicationVersion: 1 };
      },
    },
    products,
    media,
    purchases,
  );
  return { service, writes };
}

describe("ContentService", () => {
  it("rejects malformed public store filters with a query-specific fault", async () => {
    const { service } = fixture();

    await expect(
      service.readPublicSalesContent("not-a-store-id"),
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
  });

  it("publishes seller content only with owned media and active same-store products", async () => {
    const { service, writes } = fixture();
    const result = await service.publishSalesContent(
      { sessionToken: "seller", correlationId: randomUUID() },
      {
        storeId: ids.store,
        media: { mediaId: ids.media, kind: "IMAGE" },
        productIds: [ids.product],
      },
      "sales-content-1",
    );

    expect(result).toMatchObject({ source: "SELLER", moderationState: "PUBLISHED" });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      actorId: ids.seller,
      products: [{ productId: ids.product, publicationVersion: 3 }],
    });
  });

  it("rejects sales content when a linked product is not active", async () => {
    const { service } = fixture({ productPublished: false });
    await expect(
      service.publishSalesContent(
        { sessionToken: "seller", correlationId: randomUUID() },
        {
          storeId: ids.store,
          media: { mediaId: ids.media, kind: "IMAGE" },
          productIds: [ids.product],
        },
        "sales-content-2",
      ),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_PRODUCT" });
  });

  it("replays committed sales content before mutable eligibility is rechecked", async () => {
    const { service, writes } = fixture({
      replaySales: true,
      productPublished: false,
      storeFailure: new Error("must not be reached"),
    });
    await expect(
      service.publishSalesContent(
        { sessionToken: "seller", correlationId: randomUUID() },
        {
          storeId: ids.store,
          media: { mediaId: ids.media, kind: "IMAGE" },
          productIds: [ids.product],
        },
        "sales-content-replay",
      ),
    ).resolves.toMatchObject({ source: "SELLER" });
    expect(writes).toHaveLength(0);
  });

  it("requires the declared sales media kind to match stored media", async () => {
    const { service } = fixture();
    await expect(
      service.publishSalesContent(
        { sessionToken: "seller", correlationId: randomUUID() },
        {
          storeId: ids.store,
          media: { mediaId: ids.media, kind: "VIDEO" },
          productIds: [ids.product],
        },
        "sales-content-kind",
      ),
    ).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("does not disguise an unexpected store dependency failure as forbidden", async () => {
    const failure = new Error("store database unavailable");
    const { service } = fixture({ storeFailure: failure });
    await expect(
      service.publishSalesContent(
        { sessionToken: "seller", correlationId: randomUUID() },
        {
          storeId: ids.store,
          media: { mediaId: ids.media, kind: "IMAGE" },
          productIds: [ids.product],
        },
        "sales-content-store-failure",
      ),
    ).rejects.toBe(failure);
  });

  it("publishes one verified experience only for the signed-in eligible buyer", async () => {
    const { service, writes } = fixture();
    const result = await service.publishPurchaseExperience(
      { sessionToken: "buyer", correlationId: randomUUID() },
      {
        buyerId: ids.buyer,
        orderItemId: ids.orderItem,
        rating: 5,
        text: "مطابق تصویر رسید.",
        mediaIds: [ids.media],
      },
      "experience-1",
    );

    expect(result).toMatchObject({ source: "VERIFIED_PURCHASE" });
    expect(writes[0]).toMatchObject({
      actorId: ids.buyer,
      storeId: ids.store,
      productId: ids.product,
      input: { orderItemId: ids.orderItem },
    });
  });

  it("issues an opaque media upload context only after purchase eligibility", async () => {
    const { service } = fixture();
    await expect(
      service.createPurchaseExperienceMediaContext(
        { sessionToken: "buyer", correlationId: randomUUID() },
        { orderItemId: ids.orderItem },
        "experience-media-context-1",
      ),
    ).resolves.toMatchObject({
      contextId: "70000000-0000-4000-8000-000000000001",
      maxItems: 4,
    });

    const ineligible = fixture({ purchaseEligible: false });
    await expect(
      ineligible.service.createPurchaseExperienceMediaContext(
        { sessionToken: "buyer", correlationId: randomUUID() },
        { orderItemId: ids.orderItem },
        "experience-media-context-2",
      ),
    ).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("does not issue another upload context after an experience was submitted", async () => {
    const { service } = fixture({ existingExperience: true });

    await expect(
      service.createPurchaseExperienceMediaContext(
        { sessionToken: "buyer", correlationId: randomUUID() },
        { orderItemId: ids.orderItem },
        "experience-media-context-after-submit",
      ),
    ).rejects.toMatchObject({ code: "ALREADY_SUBMITTED" });
  });

  it("rejects an ineligible purchase and a buyer/body identity mismatch", async () => {
    const { service } = fixture({ purchaseEligible: false });
    const input = {
      buyerId: ids.buyer,
      orderItemId: ids.orderItem,
      rating: 4,
      text: "خوب بود.",
      mediaIds: [],
    };
    await expect(
      service.publishPurchaseExperience(
        { sessionToken: "buyer", correlationId: randomUUID() },
        input,
        "experience-2",
      ),
    ).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await expect(
      service.publishPurchaseExperience(
        { sessionToken: "seller", correlationId: randomUUID() },
        input,
        "experience-3",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("replays a committed purchase experience before eligibility is rechecked", async () => {
    const { service, writes } = fixture({
      replayPurchase: true,
      purchaseEligible: false,
    });
    await expect(
      service.publishPurchaseExperience(
        { sessionToken: "buyer", correlationId: randomUUID() },
        {
          buyerId: ids.buyer,
          orderItemId: ids.orderItem,
          rating: 5,
          text: "مطابق تصویر رسید.",
          mediaIds: [ids.media],
        },
        "experience-replay",
      ),
    ).resolves.toMatchObject({ source: "VERIFIED_PURCHASE" });
    expect(writes).toHaveLength(0);
  });

  it("reads eligibility for the signed-in buyer and reports an existing submission", async () => {
    const available = fixture();
    await expect(
      available.service.readPurchaseExperienceEligibility(
        { sessionToken: "buyer", correlationId: randomUUID() },
        ids.orderItem,
      ),
    ).resolves.toMatchObject({
      eligible: true,
      buyerId: ids.buyer,
      orderItemId: ids.orderItem,
    });

    const submitted = fixture({ existingExperience: true });
    await expect(
      submitted.service.readPurchaseExperienceEligibility(
        { sessionToken: "buyer", correlationId: randomUUID() },
        ids.orderItem,
      ),
    ).resolves.toEqual({ eligible: false, reason: "ALREADY_SUBMITTED" });
  });

  it("does not reveal another buyer's existing submission", async () => {
    const nonOwner = fixture({
      purchaseEligible: false,
      existingExperience: true,
    });

    await expect(
      nonOwner.service.readPurchaseExperienceEligibility(
        { sessionToken: "buyer", correlationId: randomUUID() },
        ids.orderItem,
      ),
    ).resolves.toEqual({ eligible: false, reason: "NOT_ELIGIBLE" });
  });

  it("returns a privacy-safe public experience feed", async () => {
    const { service } = fixture();
    await expect(service.readProductPurchaseExperiences(ids.product)).resolves.toEqual({
      productId: ids.product,
      summary: { verifiedPurchaseCount: 2, averageRating: null },
      experiences: [],
    });
  });
});
