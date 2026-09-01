import {
  createSimpleProductInputContract,
  productAuthoritativeVariantV1Contract,
  productNotFoundErrorContract,
  productPublishedV1Contract,
  productPublishedV2Contract,
  productUnpublishedV1Contract,
  publicSimpleProductContract,
  replaceSimpleProductWorkingCopyContract,
  sellerProductAccessInactiveErrorContract,
  sellerProductCursorBoundaryContract,
  sellerProductCursorContract,
  sellerProductListContract,
  sellerProductListValidationErrorContract,
  sellerProductPageLimitContract,
  sellerProductStateContract,
  simpleProductDraftContract,
} from "@sevo/contracts/product/v1";
import { MEDIA_UPLOAD_PURPOSES, MEDIA_VARIANTS } from "@sevo/contracts/media/v1";
import { describe, expect, it } from "vitest";

const ids = {
  identity: "97554510-44c2-4e02-b44f-95c17ff239de",
  store: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
  product: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
  variant: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
  media: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
  event: "78ee2a86-221f-4a73-b320-2fd315585c05",
  correlation: "7609f906-c921-490c-a793-84398fb67e0c",
};

describe("simple product v1 contract", () => {
  it("defines the live price read independently of publication snapshots and stock counts", () => {
    const variant = {
      productId: ids.product,
      variantId: ids.variant,
      storeId: ids.store,
      name: "فنجان سرامیکی",
      image: { id: ids.media, url: `/v1/media/${ids.media}` },
      unitPrice: { amount: 4_500_000, currency: "IRR" },
      publicationVersion: 1,
      sellable: true,
    };
    expect(productAuthoritativeVariantV1Contract.parse(variant)).toEqual(variant);
    expect(
      productAuthoritativeVariantV1Contract.parse({ ...variant, sellable: false })
        .sellable,
    ).toBe(false);
    for (const invalid of [
      { ...variant, unitPrice: { amount: 0, currency: "IRR" } },
      { ...variant, unitPrice: { amount: 11, currency: "IRR" } },
      { ...variant, publicationVersion: 0 },
      { ...variant, onHand: 8 },
      { ...variant, sku: "PRIVATE" },
    ]) {
      expect(productAuthoritativeVariantV1Contract.safeParse(invalid).success).toBe(
        false,
      );
    }
  });
  it("keeps creation free of caller-supplied ownership", () => {
    expect(createSimpleProductInputContract.parse({})).toEqual({});
    expect(
      createSimpleProductInputContract.safeParse({ storeId: ids.store }).success,
    ).toBe(false);
  });

  it("accepts one physical variant while keeping inventory in its own command", () => {
    const input = {
      expectedRevision: 0,
      workingCopy: {
        name: "فنجان سرامیکی",
        description: "فنجان دست‌ساز مناسب نوشیدنی گرم",
        orderedMediaIds: [ids.media],
        variant: {
          clientKey: "simple",
          price: { amount: 4_500_000, currency: "IRR" },
        },
      },
      inventory: { onHand: 8, expectedRevision: 0 },
    };

    expect(replaceSimpleProductWorkingCopyContract.parse(input)).toEqual(input);
    expect(
      replaceSimpleProductWorkingCopyContract.safeParse({
        ...input,
        inventory: { onHand: -1, expectedRevision: 0 },
      }).success,
    ).toBe(false);
    expect(
      replaceSimpleProductWorkingCopyContract.safeParse({
        ...input,
        workingCopy: {
          ...input.workingCopy,
          variant: {
            ...input.workingCopy.variant,
            price: { amount: 4_500_005, currency: "IRR" },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts a cumulative incomplete working copy between authoring steps", () => {
    expect(
      replaceSimpleProductWorkingCopyContract.parse({
        expectedRevision: 0,
        workingCopy: {
          name: "فنجان سرامیکی",
          description: "",
          orderedMediaIds: [],
          variant: { clientKey: "simple", price: null },
        },
        inventory: null,
      }),
    ).toBeDefined();
  });

  it("separates the private draft from the public projection", () => {
    const draft = simpleProductDraftContract.parse({
      productId: ids.product,
      state: "DRAFT",
      revision: 1,
      publicationVersion: 0,
      workingCopy: {
        name: "فنجان سرامیکی",
        description: "فنجان دست‌ساز مناسب نوشیدنی گرم",
        orderedMediaIds: [ids.media],
        variant: {
          variantId: ids.variant,
          price: { amount: 4_500_000, currency: "IRR" },
        },
      },
      inventory: { onHand: 8, revision: 1 },
    });
    expect(draft.inventory.onHand).toBe(8);

    const publicProduct = publicSimpleProductContract.parse({
      productId: ids.product,
      variantId: ids.variant,
      name: draft.workingCopy.name,
      description: draft.workingCopy.description,
      image: { id: ids.media, url: `/v1/media/${ids.media}` },
      price: draft.workingCopy.variant.price,
      availability: "AVAILABLE",
      publicationVersion: 1,
    });
    expect(publicProduct).not.toHaveProperty("inventory");
    expect(publicProduct).not.toHaveProperty("sku");
  });

  it("validates the versioned publication event without private stock", () => {
    const event = productPublishedV1Contract.parse({
      version: 1,
      eventId: ids.event,
      eventType: "ProductPublished.v1",
      aggregateId: ids.product,
      aggregateVersion: 2,
      occurredAt: "2026-08-24T12:00:00.000Z",
      correlationId: ids.correlation,
      actor: { type: "IDENTITY", id: ids.identity },
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 1,
        snapshot: {
          productId: ids.product,
          name: "فنجان سرامیکی",
          image: { id: ids.media, url: `/v1/media/${ids.media}` },
          price: { amount: 4_500_000, currency: "IRR" },
          availability: "AVAILABLE",
          publicationVersion: 1,
        },
        offerVersion: 1,
        availabilityVersion: 1,
      },
    });
    expect(event.payload).not.toHaveProperty("onHand");

    const privacySafeEvent = productPublishedV2Contract.parse({
      ...event,
      eventType: "ProductPublished.v2",
      payload: {
        ...event.payload,
        snapshot: { variantIds: [ids.variant] },
      },
    });
    expect(JSON.stringify(privacySafeEvent.payload)).not.toMatch(
      /onHand|sku|name|description|image|url/i,
    );
    for (const invalid of [
      { ...privacySafeEvent, eventType: "ProductPublished.v1" },
      { ...privacySafeEvent, version: 2 },
      { ...privacySafeEvent, actor: undefined },
      {
        ...privacySafeEvent,
        payload: { ...privacySafeEvent.payload, snapshot: event.payload.snapshot },
      },
      {
        ...privacySafeEvent,
        payload: { ...privacySafeEvent.payload, snapshot: { variantIds: [] } },
      },
      { ...privacySafeEvent, payload: { ...privacySafeEvent.payload, onHand: 8 } },
    ])
      expect(productPublishedV2Contract.safeParse(invalid).success).toBe(false);

    const unpublished = productUnpublishedV1Contract.parse({
      ...event,
      eventType: "ProductUnpublished.v1",
      aggregateVersion: 3,
      payload: {
        storeId: ids.store,
        productId: ids.product,
        publicationVersion: 1,
      },
    });
    expect(JSON.stringify(unpublished.payload)).not.toMatch(
      /reason|onHand|sku|name|description|image|url/i,
    );
  });
});

describe("seller product list v1 contract", () => {
  const summary = {
    productId: ids.product,
    name: "فنجان سرامیکی",
    primaryMediaId: ids.media,
    state: "DRAFT" as const,
    revision: 2,
    publicationVersion: 0,
  };

  it("validates stable pagination inputs and the empty page", () => {
    expect(sellerProductPageLimitContract.parse("20")).toBe(20);
    for (const invalid of ["0", "51", "1.5", "many"]) {
      expect(sellerProductPageLimitContract.safeParse(invalid).success).toBe(false);
    }

    expect(sellerProductStateContract.parse("PUBLISHED")).toBe("PUBLISHED");
    expect(sellerProductStateContract.safeParse("ARCHIVED").success).toBe(false);

    const boundary = {
      createdAt: "2026-08-30T10:30:00.000Z",
      productId: ids.product,
    };
    const cursor = Buffer.from(`${boundary.createdAt}|${boundary.productId}`).toString(
      "base64url",
    );
    expect(sellerProductCursorContract.parse(cursor)).toBe(cursor);
    expect(sellerProductCursorBoundaryContract.parse(boundary)).toEqual(boundary);
    expect(sellerProductCursorContract.safeParse("not-a-cursor").success).toBe(false);
    expect(
      sellerProductCursorBoundaryContract.safeParse({
        ...boundary,
        createdAt: "2026-02-30T10:30:00.000Z",
      }).success,
    ).toBe(false);

    expect(sellerProductListContract.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("keeps seller summaries strict and free of unrelated private data", () => {
    expect(
      sellerProductListContract.parse({ items: [summary], nextCursor: null }),
    ).toEqual({ items: [summary], nextCursor: null });

    for (const privateField of [
      "viewCount",
      "likeCount",
      "bankAccount",
      "mobile",
      "buyerId",
    ]) {
      expect(
        sellerProductListContract.safeParse({
          items: [{ ...summary, [privateField]: "private" }],
          nextCursor: null,
        }).success,
        privateField,
      ).toBe(false);
    }
  });

  it("keeps list failures aligned with the owner error envelope", () => {
    const base = {
      version: 1 as const,
      message: "درخواست قابل انجام نیست.",
      correlationId: ids.correlation,
      details: { issues: [] },
    };
    expect(
      sellerProductAccessInactiveErrorContract.parse({
        ...base,
        code: "SELLER_ACCESS_INACTIVE",
      }),
    ).toMatchObject({ version: 1, details: { issues: [] } });
    expect(
      productNotFoundErrorContract.parse({ ...base, code: "PRODUCT_NOT_FOUND" }),
    ).toMatchObject({ version: 1, details: { issues: [] } });
    expect(
      sellerProductListValidationErrorContract.parse({
        ...base,
        code: "VALIDATION_ERROR",
        details: {
          issues: [{ path: "query.cursor", code: "INVALID_FORMAT" }],
        },
      }),
    ).toMatchObject({
      version: 1,
      details: { issues: [{ path: "query.cursor" }] },
    });
  });
});

describe("product image media v1 extension", () => {
  it("offers fixed product image purpose and derivatives", () => {
    expect(MEDIA_UPLOAD_PURPOSES).toContain("PRODUCT_IMAGE");
    expect(MEDIA_VARIANTS).toEqual(
      expect.arrayContaining(["product-card", "product-detail"]),
    );
  });
});
