import { describe, expect, it } from "vitest";
import { storeSlugContract } from "@sevo/contracts/store/v1";

import { IncompleteStoreError, StoreService } from "./store.service";
import type { StoreRepository, StoreRow } from "../public";

class MemoryStoreRepository implements StoreRepository {
  row?: StoreRow;

  async findBySellerId() {
    return this.row;
  }

  async findBySlug() {
    return undefined;
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
});
