import {
  storeAuthoritativeSnapshotV1Contract,
  storePolicyChangedV1Contract,
  storePublishedV1Contract,
  storeUnpublishedV1Contract,
  type StoreAuthoritativeSnapshotV1,
} from "@sevo/contracts/store/v1";
import { describe, expect, it } from "vitest";

import { DiscoveryStoreContractConsumer } from "../../apps/api/src/modules/discovery/store-contract.consumer";
import { ProductStoreContractConsumer } from "../../apps/api/src/modules/product/store-contract.consumer";

import {
  StoreNotSellableError,
  StoreOwnershipRequiredError,
  type ApprovedSellerStoreProvisioner,
  type StoreAuthoritativeRead,
} from "../../apps/api/src/modules/store/public";

const storeId = "c47ac10b-58cc-4372-a567-0e02b2c3d479" as never;
const ownerIdentityId = "e47ac10b-58cc-4372-a567-0e02b2c3d479" as never;

function authoritativeStore(
  overrides: Partial<StoreAuthoritativeSnapshotV1> = {},
): StoreAuthoritativeSnapshotV1 {
  return storeAuthoritativeSnapshotV1Contract.parse({
    storeId,
    revision: 4,
    publicationVersion: 2,
    publicationStatus: "PUBLISHED",
    owner: { identityId: ownerIdentityId },
    slug: "khane-sofal-mah",
    displayIdentity: {
      name: "خانه سفال ماه",
      bio: "سفال دست‌ساز برای خانه‌های گرم و ساده",
      logoMediaId: null,
      coverMediaId: null,
      themeColor: "#A41439",
    },
    shippingMethods: [
      {
        id: "a47ac10b-58cc-4372-a567-0e02b2c3d479",
        revision: 1,
        code: "NATIONAL_POST",
        label: "پست پیشتاز",
        fixedFee: { amount: 0, currency: "IRR" },
        estimatedDeliveryText: "سه تا پنج روز کاری",
        enabled: true,
        requiresDeliveryAddress: true,
        requiresPostalCode: true,
      },
    ],
    returnPolicy: {
      revision: 2,
      text: "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.",
    },
    settlement: { mode: "DIRECT", status: "TEST_VERIFIED" },
    updatedAt: "2026-08-24T09:00:00.000Z",
    publishedAt: "2026-08-24T08:00:00.000Z",
    ...overrides,
  });
}

class ExplicitStoreReadFake implements StoreAuthoritativeRead {
  constructor(private readonly store?: StoreAuthoritativeSnapshotV1) {}

  async readStore(storeIdToRead: typeof storeId) {
    return this.store?.storeId === storeIdToRead ? this.store : undefined;
  }

  async requireOwnership(
    identityId: typeof ownerIdentityId,
    storeIdToRead: typeof storeId,
  ) {
    const store = await this.readStore(storeIdToRead);
    if (!store || store.owner.identityId !== identityId) {
      throw new StoreOwnershipRequiredError(storeIdToRead);
    }
    return store;
  }

  async requireSellable(storeIdToRead: typeof storeId) {
    const store = await this.readStore(storeIdToRead);
    if (!store || store.publicationStatus !== "PUBLISHED") {
      throw new StoreNotSellableError(storeIdToRead);
    }
    return store;
  }

  async requireOwnedSellable(
    identityId: typeof ownerIdentityId,
    storeIdToRead: typeof storeId,
  ) {
    const store = await this.requireOwnership(identityId, storeIdToRead);
    if (store.publicationStatus !== "PUBLISHED" || !store.settlement) {
      throw new StoreNotSellableError(storeIdToRead);
    }
    return store;
  }
}

class ExplicitApprovedSellerProvisionerFake implements ApprovedSellerStoreProvisioner {
  readonly calls: unknown[] = [];

  async provisionApprovedSellerStore(
    command: Parameters<
      ApprovedSellerStoreProvisioner["provisionApprovedSellerStore"]
    >[0],
  ) {
    this.calls.push(command);
    return { storeId, revision: 1 };
  }
}

describe("Store v1 consumer contracts", () => {
  it("gives product an authoritative ownership and sellability seam", async () => {
    const consumer = new ProductStoreContractConsumer(
      new ExplicitStoreReadFake(authoritativeStore()),
    );

    await expect(
      consumer.requireProductPublicationStore(ownerIdentityId, storeId),
    ).resolves.toMatchObject({
      storeId,
      storeRevision: 4,
      publicationVersion: 2,
    });
  });

  it("gives discovery public identity and publication data without private metrics", async () => {
    const snapshot = await new DiscoveryStoreContractConsumer(
      new ExplicitStoreReadFake(authoritativeStore()),
    ).readPublishedStore(storeId);

    expect(snapshot).toMatchObject({
      storeId,
      slug: "khane-sofal-mah",
      displayIdentity: { name: "خانه سفال ماه" },
      publicationStatus: "PUBLISHED",
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /view|like|save|share|conversion|cart|growth|settlementDestination/i,
    );
  });

  it("gives identity an idempotent provisioning port without exposing persistence", async () => {
    const provisioner = new ExplicitApprovedSellerProvisionerFake();
    const result = await provisioner.provisionApprovedSellerStore({
      identityId: ownerIdentityId,
      proposedStoreName: "خانه سفال ماه",
      idempotencyKey: "approve-application-1",
      correlationId: "d47ac10b-58cc-4372-a567-0e02b2c3d479",
      transactionContext: { kind: "opaque-store-transaction" },
    });

    expect(result).toEqual({ storeId, revision: 1 });
    expect(provisioner.calls).toHaveLength(1);
  });

  it("keeps ownership and sellability failures stable", async () => {
    const consumer = new ProductStoreContractConsumer(
      new ExplicitStoreReadFake(
        authoritativeStore({ publicationStatus: "DRAFT", publishedAt: undefined }),
      ),
    );

    await expect(
      consumer.requireProductPublicationStore(
        "f47ac10b-58cc-4372-a567-0e02b2c3d479" as never,
        storeId,
      ),
    ).rejects.toMatchObject({ code: "STORE_OWNERSHIP_REQUIRED" });

    const ownerConsumer = new ProductStoreContractConsumer(
      new ExplicitStoreReadFake(
        authoritativeStore({ publicationStatus: "DRAFT", publishedAt: undefined }),
      ),
    );
    await expect(
      ownerConsumer.requireProductPublicationStore(ownerIdentityId, storeId),
    ).rejects.toMatchObject({ code: "STORE_NOT_SELLABLE" });
  });

  it("publishes versioned PII-free events for publication and policy changes", () => {
    const envelope = {
      version: 1,
      eventId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
      aggregateId: storeId,
      aggregateVersion: 4,
      occurredAt: "2026-08-24T09:00:00.000Z",
      correlationId: "d47ac10b-58cc-4372-a567-0e02b2c3d479",
      actor: { type: "IDENTITY", id: ownerIdentityId },
    } as const;
    const events = [
      storePublishedV1Contract.parse({
        ...envelope,
        eventType: "StorePublished.v1",
        payload: { storeId, publicationStatus: "PUBLISHED", publicationVersion: 2 },
      }),
      storeUnpublishedV1Contract.parse({
        ...envelope,
        eventType: "StoreUnpublished.v1",
        payload: { storeId, publicationStatus: "DRAFT", publicationVersion: 2 },
      }),
      storePolicyChangedV1Contract.parse({
        ...envelope,
        eventType: "StorePolicyChanged.v1",
        payload: {
          storeId,
          returnPolicyRevision: 2,
          shippingMethods: [
            { id: "a47ac10b-58cc-4372-a567-0e02b2c3d479", revision: 1 },
          ],
        },
      }),
    ];

    expect(events.map((event) => event.eventType)).toEqual([
      "StorePublished.v1",
      "StoreUnpublished.v1",
      "StorePolicyChanged.v1",
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /mobile|address|returnPolicyText|estimatedDeliveryText|settlementDestination/i,
    );
  });
});
