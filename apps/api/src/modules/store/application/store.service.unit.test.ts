import { describe, expect, it } from "vitest";
import {
  storeDraftContract,
  storeDraftInputContract,
  storeSlugContract,
} from "@sevo/contracts/store/v1";

import {
  IncompleteStoreError,
  StoreService,
  StoreSlugConflictError,
} from "./store.service";
import type { StoreRepository, StoreRow, StoreWriteContext } from "../public";

class MemoryStoreRepository implements StoreRepository {
  row?: StoreRow;
  slugOwner?: StoreRow;

  async findById(id: string) {
    return this.row?.id === id ? this.row : undefined;
  }

  async findBySellerId() {
    return this.row;
  }

  async findBySlug(slug: string) {
    return this.row?.slug === slug ? this.row : this.slugOwner;
  }

  async isMediaPublished(mediaId: string) {
    return (
      this.row?.status === "PUBLISHED" &&
      (this.row.logoMediaId === mediaId || this.row.coverMediaId === mediaId)
    );
  }

  async saveDraft(row: StoreRow) {
    this.row = row;
    return row;
  }

  async publish(_id: string, publishedAt: Date, context: StoreWriteContext) {
    void context;
    if (!this.row) throw new Error("missing store");
    this.row = {
      ...this.row,
      status: "PUBLISHED",
      publishedAt,
      revision: (this.row.revision ?? 0) + 1,
      publicationVersion: (this.row.publicationVersion ?? 0) + 1,
    };
    return this.row;
  }
}

describe("StoreService publication", () => {
  it("omits database nulls from an incomplete draft response", async () => {
    const repository = new MemoryStoreRepository();
    repository.saveDraft = async (row) => {
      repository.row = {
        ...row,
        slug: null as never,
        bio: null as never,
        returnPolicy: null as never,
      };
      return repository.row;
    };
    const service = new StoreService(repository, async (destination) => ({
      ...destination,
      status: "TEST_VERIFIED",
      verifiedAt: new Date(),
    }));

    const draft = await service.saveDraft(
      "seller-1",
      { name: "خانه ماه" },
      writeContext(0),
    );

    expect(storeDraftContract.safeParse(draft).success).toBe(true);
    expect(draft.slug).toBeUndefined();
    expect(draft.bio).toBeUndefined();
    expect(draft.returnPolicy).toBeUndefined();
  });

  it("reports missing fields and refuses to publish an incomplete draft", async () => {
    const repository = new MemoryStoreRepository();
    const service = new StoreService(repository, async (destination) => ({
      ...destination,
      status: "TEST_VERIFIED",
      verifiedAt: new Date("2026-08-16T09:00:00.000Z"),
    }));

    await service.saveDraft("seller-1", { name: "خانه ماه" }, writeContext(0));

    await expect(service.publish("seller-1", writeContext(1))).rejects.toEqual(
      new IncompleteStoreError([
        "SLUG",
        "BIO",
        "SHIPPING_METHOD",
        "RETURN_POLICY",
        "SETTLEMENT_DESTINATION",
      ]),
    );
  });

  it("publishes a complete store without requiring a product", async () => {
    const repository = new MemoryStoreRepository();
    const service = new StoreService(
      repository,
      async (destination) => ({
        ...destination,
        status: "TEST_VERIFIED",
        verifiedAt: new Date("2026-08-16T09:00:00.000Z"),
      }),
      () => new Date("2026-08-16T09:30:00.000Z"),
    );

    await service.saveDraft(
      "seller-1",
      {
        name: "خانه ماه",
        slug: storeSlugContract.parse("khane-mah"),
        bio: "سفال دست‌ساز برای خانه",
        shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
        returnPolicy: "تا هفت روز امکان درخواست مرجوعی وجود دارد.",
        settlementDestination: { kind: "TEST" },
        logoMediaId: null,
        coverMediaId: null,
        themeColor: "#A41439",
      },
      writeContext(0),
    );

    const publication = await service.publish("seller-1", writeContext(1));

    expect(publication.publicUrl).toBe("/s/khane-mah");
    expect(publication.store).toMatchObject({
      status: "PUBLISHED",
      activeProductCount: 0,
      trust: {
        settlementStatus: "TEST_VERIFIED",
        platformBrandingRequired: true,
      },
    });
  });

  it("rejects a slug already owned by another seller", async () => {
    const repository = new MemoryStoreRepository();
    repository.slugOwner = {
      id: "store-2",
      sellerId: "seller-2",
      slug: "khane-mah",
      status: "DRAFT",
      updatedAt: new Date(),
    };
    const service = new StoreService(repository, async (destination) => ({
      ...destination,
      status: "TEST_VERIFIED",
      verifiedAt: new Date(),
    }));

    await expect(
      service.saveDraft(
        "seller-1",
        {
          slug: storeSlugContract.parse("khane-mah"),
        },
        writeContext(0),
      ),
    ).rejects.toEqual(new StoreSlugConflictError("khane-mah"));
  });

  it("returns a published store to draft before applying edits", async () => {
    const repository = new MemoryStoreRepository();
    repository.row = {
      id: "store-1",
      sellerId: "seller-1",
      name: "نام قبلی",
      status: "PUBLISHED",
      revision: 2,
      publicationVersion: 1,
      publishedAt: new Date("2026-08-16T09:00:00.000Z"),
      updatedAt: new Date("2026-08-16T09:00:00.000Z"),
    };
    const service = new StoreService(repository, async (destination) => ({
      ...destination,
      status: "TEST_VERIFIED",
      verifiedAt: new Date(),
    }));

    const draft = await service.saveDraft(
      "seller-1",
      { name: "نام تازه" },
      writeContext(2),
    );

    expect(draft).toMatchObject({ name: "نام تازه", status: "DRAFT" });
    expect(repository.row?.publishedAt).toBeUndefined();
  });

  it("makes media eligible before the store becomes publicly readable", async () => {
    const events: string[] = [];
    const repository = new MemoryStoreRepository();
    const originalPublish = repository.publish.bind(repository);
    repository.publish = async (id, publishedAt, context) => {
      events.push("store-published");
      return originalPublish(id, publishedAt, context);
    };
    const service = new StoreService(
      repository,
      async (destination) => ({
        ...destination,
        status: "TEST_VERIFIED",
        verifiedAt: new Date(),
      }),
      undefined,
      async () => ({ contentType: "image/webp", ownerSellerId: "seller-1" }),
      async () => {
        events.push("media-public");
      },
    );
    await service.saveDraft(
      "seller-1",
      {
        name: "خانه ماه",
        slug: storeSlugContract.parse("khane-mah"),
        bio: "سفال دست‌ساز برای خانه",
        shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
        returnPolicy: "تا هفت روز امکان درخواست مرجوعی وجود دارد.",
        settlementDestination: { kind: "TEST" },
        logoMediaId: "media-1" as never,
      },
      writeContext(0),
    );

    await service.publish("seller-1", writeContext(1));
    const repeated = await service.publish("seller-1", writeContext(2));

    expect(events).toEqual(["media-public", "store-published", "store-published"]);
    expect(repeated.store.status).toBe("PUBLISHED");
  });

  it("serves the canonical ownership and sellability snapshot", async () => {
    const repository = new MemoryStoreRepository();
    repository.row = {
      id: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
      sellerId: "e47ac10b-58cc-4372-a567-0e02b2c3d479",
      name: "خانه ماه",
      slug: "khane-mah",
      bio: "سفال دست‌ساز برای خانه",
      shippingMethods: [
        {
          id: "a47ac10b-58cc-4372-a567-0e02b2c3d479",
          revision: 1,
          code: "NATIONAL_POST",
          label: "پست پیشتاز",
          fixedFeeAmount: 0,
          currency: "IRR",
          estimatedDeliveryText: "سه تا پنج روز کاری",
          enabled: true,
          requiresDeliveryAddress: true,
          requiresPostalCode: true,
        },
      ],
      returnPolicy: "تا هفت روز امکان درخواست مرجوعی وجود دارد.",
      returnPolicyRevision: 2,
      settlementDestination: {
        kind: "TEST",
        status: "TEST_VERIFIED",
        verifiedAt: new Date("2026-08-16T08:00:00.000Z"),
      },
      themeColor: "#A41439",
      status: "PUBLISHED",
      revision: 4,
      publicationVersion: 2,
      publishedAt: new Date("2026-08-16T09:00:00.000Z"),
      updatedAt: new Date("2026-08-16T09:00:00.000Z"),
    };
    const service = new StoreService(repository, async (destination) => ({
      ...destination,
      status: "TEST_VERIFIED",
      verifiedAt: new Date(),
    }));

    await expect(
      service.requireOwnership(
        repository.row.sellerId as never,
        repository.row.id as never,
      ),
    ).resolves.toMatchObject({
      revision: 4,
      publicationVersion: 2,
      owner: { identityId: repository.row.sellerId },
      returnPolicy: { revision: 2 },
    });
    await expect(
      service.requireSellable(repository.row.id as never),
    ).resolves.toMatchObject({ publicationStatus: "PUBLISHED" });
    await expect(
      service.requireOwnedSellable(
        repository.row.sellerId as never,
        repository.row.id as never,
      ),
    ).resolves.toMatchObject({ revision: 4, publicationStatus: "PUBLISHED" });
  });

  it("keeps shipping method identity when methods are reordered", async () => {
    const repository = new MemoryStoreRepository();
    repository.row = {
      id: "store-1",
      sellerId: "seller-1",
      shippingMethods: [
        shippingMethod("national-post-id", "NATIONAL_POST", "پست پیشتاز"),
        shippingMethod("pickup-id", "PICKUP", "تحویل حضوری"),
      ],
      status: "DRAFT",
      revision: 1,
      updatedAt: new Date("2026-08-16T09:00:00.000Z"),
    };
    const service = new StoreService(repository, async (destination) => ({
      ...destination,
      status: "TEST_VERIFIED",
      verifiedAt: new Date(),
    }));

    const draft = await service.saveDraft(
      "seller-1",
      {
        shippingMethods: [
          { code: "PICKUP", label: "تحویل حضوری" },
          { code: "NATIONAL_POST", label: "پست پیشتاز" },
        ],
      },
      writeContext(1),
    );

    expect(
      draft.shippingMethods?.map(({ id, revision }) => ({ id, revision })),
    ).toEqual([
      { id: "pickup-id", revision: 1 },
      { id: "national-post-id", revision: 1 },
    ]);
  });

  it("rejects duplicate shipping method codes at the contract boundary", () => {
    expect(
      storeDraftInputContract.safeParse({
        shippingMethods: [
          { code: "PICKUP", label: "تحویل حضوری" },
          { code: "PICKUP", label: "دریافت از فروشگاه" },
        ],
      }).success,
    ).toBe(false);
  });
});

function shippingMethod(
  id: string,
  code: "NATIONAL_POST" | "COURIER" | "PICKUP",
  label: string,
) {
  return {
    id,
    revision: 1,
    code,
    label,
    fixedFeeAmount: 0,
    currency: "IRR" as const,
    estimatedDeliveryText: "سه تا پنج روز کاری",
    enabled: true,
    requiresDeliveryAddress: code !== "PICKUP",
    requiresPostalCode: code === "NATIONAL_POST",
  };
}

function writeContext(expectedRevision: number) {
  return {
    correlationId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    expectedRevision,
  };
}
