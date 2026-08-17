import { describe, expect, it } from "vitest";
import { storeSlugContract } from "@sevo/contracts/store/v1";

import {
  IncompleteStoreError,
  StoreService,
  StoreSlugConflictError,
} from "./store.service";
import type { StoreRepository, StoreRow } from "../public";

class MemoryStoreRepository implements StoreRepository {
  row?: StoreRow;
  slugOwner?: StoreRow;

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

  async publish(_id: string, publishedAt: Date) {
    if (!this.row) throw new Error("missing store");
    this.row = { ...this.row, status: "PUBLISHED", publishedAt };
    return this.row;
  }
}

describe("StoreService publication", () => {
  it("reports missing fields and refuses to publish an incomplete draft", async () => {
    const repository = new MemoryStoreRepository();
    const service = new StoreService(repository, async (destination) => ({
      ...destination,
      status: "TEST_VERIFIED",
      verifiedAt: new Date("2026-08-16T09:00:00.000Z"),
    }));

    await service.saveDraft("seller-1", { name: "خانه ماه" });

    await expect(service.publish("seller-1")).rejects.toEqual(
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

    await service.saveDraft("seller-1", {
      name: "خانه ماه",
      slug: storeSlugContract.parse("khane-mah"),
      bio: "سفال دست‌ساز برای خانه",
      shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
      returnPolicy: "تا هفت روز امکان درخواست مرجوعی وجود دارد.",
      settlementDestination: { kind: "TEST" },
      logoMediaId: null,
      coverMediaId: null,
      themeColor: "#A41439",
    });

    const publication = await service.publish("seller-1");

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
      service.saveDraft("seller-1", {
        slug: storeSlugContract.parse("khane-mah"),
      }),
    ).rejects.toEqual(new StoreSlugConflictError("khane-mah"));
  });

  it("returns a published store to draft before applying edits", async () => {
    const repository = new MemoryStoreRepository();
    repository.row = {
      id: "store-1",
      sellerId: "seller-1",
      name: "نام قبلی",
      status: "PUBLISHED",
      publishedAt: new Date("2026-08-16T09:00:00.000Z"),
      updatedAt: new Date("2026-08-16T09:00:00.000Z"),
    };
    const service = new StoreService(repository, async (destination) => ({
      ...destination,
      status: "TEST_VERIFIED",
      verifiedAt: new Date(),
    }));

    const draft = await service.saveDraft("seller-1", { name: "نام تازه" });

    expect(draft).toMatchObject({ name: "نام تازه", status: "DRAFT" });
    expect(repository.row?.publishedAt).toBeUndefined();
  });

  it("makes media eligible before the store becomes publicly readable", async () => {
    const events: string[] = [];
    const repository = new MemoryStoreRepository();
    const originalPublish = repository.publish.bind(repository);
    repository.publish = async (id, publishedAt) => {
      events.push("store-published");
      return originalPublish(id, publishedAt);
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
    await service.saveDraft("seller-1", {
      name: "خانه ماه",
      slug: storeSlugContract.parse("khane-mah"),
      bio: "سفال دست‌ساز برای خانه",
      shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
      returnPolicy: "تا هفت روز امکان درخواست مرجوعی وجود دارد.",
      settlementDestination: { kind: "TEST" },
      logoMediaId: "media-1" as never,
    });

    await service.publish("seller-1");

    expect(events).toEqual(["media-public", "store-published"]);
  });
});
