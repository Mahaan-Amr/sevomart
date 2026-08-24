import {
  createSimpleProductInputContract,
  productPublishedV1Contract,
  publicSimpleProductContract,
  replaceSimpleProductWorkingCopyContract,
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
