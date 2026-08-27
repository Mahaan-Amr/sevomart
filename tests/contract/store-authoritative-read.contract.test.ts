import { describe, expect, it } from "vitest";
import {
  storeAuthoritativeSnapshotV1Contract,
  storeAuthoritativeReadErrorV1Contract,
  storeSlugContract,
  storeV1Examples,
} from "@sevo/contracts/store/v1";
import { identityIdContract, storeIdContract } from "@sevo/contracts/platform/v1";

import { StoreService } from "../../apps/api/src/modules/store/application/store.service";
import type {
  StoreRepository,
  StoreRow,
} from "../../apps/api/src/modules/store/public";

const storeId = storeIdContract.parse("c47ac10b-58cc-4372-a567-0e02b2c3d479");
const ownerId = identityIdContract.parse("e47ac10b-58cc-4372-a567-0e02b2c3d479");

function storeRepository(): StoreRepository {
  const example = storeV1Examples.PublicStore;
  const row: StoreRow = {
    id: storeId,
    sellerId: ownerId,
    name: example.name,
    slug: example.slug,
    bio: example.bio,
    status: "PUBLISHED",
    revision: 2,
    publicationVersion: 1,
    returnPolicyRevision: 1,
    returnPolicy: example.returnPolicy,
    shippingMethods: example.shippingMethods.map(({ fixedFee, ...method }) => ({
      ...method,
      fixedFeeAmount: fixedFee.amount,
      currency: fixedFee.currency,
    })),
    settlementDestination: {
      kind: "TEST",
      status: "TEST_VERIFIED",
      verifiedAt: new Date("2026-08-24T08:00:00.000Z"),
    },
    updatedAt: new Date("2026-08-24T09:00:00.000Z"),
    publishedAt: new Date("2026-08-24T08:00:00.000Z"),
  };
  return {
    async findById(id) {
      return id === storeId ? row : undefined;
    },
    async findBySellerId(id) {
      return id === ownerId ? row : undefined;
    },
    async findBySlug(slug) {
      return slug === row.slug ? row : undefined;
    },
    async isMediaPublished() {
      return false;
    },
    async saveDraft() {
      throw new Error("Read-only fixture");
    },
    async publish() {
      throw new Error("Read-only fixture");
    },
  };
}

describe("Store authoritative read contract", () => {
  it("reads live seller eligibility separately from the stored publication state", async () => {
    let active = true;
    const service = new StoreService(
      storeRepository(),
      async () => {
        throw new Error("Read-only fixture");
      },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        async isActiveSeller() {
          return active;
        },
      },
    );

    expect(await service.readStore(storeId)).toMatchObject({
      publicationStatus: "PUBLISHED",
      sellerAccess: { active: true },
    });
    active = false;
    const snapshot = await service.readOwnedStore(ownerId);
    expect(snapshot).toMatchObject({
      publicationStatus: "PUBLISHED",
      sellerAccess: { active: false },
    });
    expect(storeAuthoritativeSnapshotV1Contract.parse(snapshot)).toEqual(snapshot);
    expect(
      await service.readPublishedStoreBySlug(
        storeSlugContract.parse(storeV1Examples.PublicStore.slug),
      ),
    ).toMatchObject({ sellerAccess: { active: false } });
    expect(
      await service.readPublished(storeV1Examples.PublicStore.slug),
    ).not.toHaveProperty("sellerAccess");
  });

  it("returns absence and stable ownership/sellability errors through the real read service", async () => {
    const service = new StoreService(storeRepository(), async () => {
      throw new Error("Read-only fixture");
    });
    const absentId = storeIdContract.parse("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    expect(await service.readStore(absentId)).toBeUndefined();
    expect(
      await service.readOwnedStore(identityIdContract.parse(absentId)),
    ).toBeUndefined();
    expect(
      await service.readPublishedStoreBySlug(storeSlugContract.parse("missing-store")),
    ).toBeUndefined();
    for (const [operation, code] of [
      [() => service.requireOwnership(ownerId, absentId), "STORE_OWNERSHIP_REQUIRED"],
      [() => service.requireSellable(absentId), "STORE_NOT_SELLABLE"],
      [
        () => service.requireOwnedSellable(ownerId, absentId),
        "STORE_OWNERSHIP_REQUIRED",
      ],
    ] as const) {
      await expect(operation()).rejects.toMatchObject({ code, storeId: absentId });
      const error = await operation().catch((error: unknown) => error);
      expect(storeAuthoritativeReadErrorV1Contract.parse(error)).toEqual({
        code,
        storeId: absentId,
      });
    }
  });

  it("propagates seller access failures instead of inventing an active grant", async () => {
    const unavailable = new Error("Identity reader unavailable");
    const service = new StoreService(
      storeRepository(),
      async () => {
        throw new Error("Read-only fixture");
      },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        async isActiveSeller() {
          throw unavailable;
        },
      },
    );
    await expect(service.readStore(storeId)).rejects.toBe(unavailable);
  });
});
