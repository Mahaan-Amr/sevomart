import * as store from "@sevo/contracts/store/v1";
import { describe, expect, it } from "vitest";

describe("Store v1 executable schema surface", () => {
  it("does not count whitespace-only information as publication prerequisites", () => {
    for (const field of ["name", "bio", "returnPolicy"]) {
      expect(
        store.storeDraftInputContract.safeParse({ [field]: "            " }).success,
      ).toBe(false);
    }
    expect(
      store.storeDraftInputContract.safeParse({
        shippingMethods: [{ code: "PICKUP", label: "    " }],
      }).success,
    ).toBe(false);
  });

  it("keeps pre-normalization store records readable without weakening new writes", () => {
    const legacyDraft = {
      ...store.storeV1Examples.StoreDraft,
      name: "  ",
      bio: " x",
      returnPolicy: "          ",
      shippingMethods: store.storeV1Examples.StoreDraft.shippingMethods?.map(
        (method, index) => (index === 0 ? { ...method, label: "  " } : method),
      ),
    };
    expect(store.storeDraftContract.safeParse(legacyDraft).success).toBe(true);
    expect(
      store.storeDraftInputContract.safeParse({
        name: legacyDraft.name,
        bio: legacyDraft.bio,
        returnPolicy: legacyDraft.returnPolicy,
        shippingMethods: legacyDraft.shippingMethods?.map(({ code, label }) => ({
          code,
          label,
        })),
      }).success,
    ).toBe(false);
  });

  it("accepts explicit shipping terms while retaining legacy inputs", () => {
    const method = {
      code: "NATIONAL_POST",
      label: "پست پیشتاز",
      fixedFee: { amount: 650_000, currency: "IRR" },
      estimatedDeliveryText: "سه تا پنج روز کاری",
      enabled: true,
    };
    expect(store.storeDraftInputContract.parse({ shippingMethods: [method] })).toEqual({
      shippingMethods: [method],
    });
    expect(
      store.storeDraftInputContract.parse(store.storeV1Examples.StoreDraftInput),
    ).toEqual(store.storeV1Examples.StoreDraftInput);
    for (const fixedFee of [
      { amount: -10, currency: "IRR" },
      { amount: 11, currency: "IRR" },
      { amount: 100, currency: "USD" },
    ]) {
      expect(
        store.storeDraftInputContract.safeParse({
          shippingMethods: [{ ...method, fixedFee }],
        }).success,
      ).toBe(false);
    }
  });

  it("exports the authoritative read, seller eligibility, errors and events to OpenAPI", () => {
    const schemas = store.createStoreV1JsonSchemas();
    for (const name of [
      "StoreAuthoritativeSnapshotV1",
      "StoreSellerAccessV1",
      "StoreAuthoritativeReadErrorV1",
      "StorePublishedV1",
      "StoreUnpublishedV1",
      "StorePolicyChangedV1",
    ]) {
      expect(schemas, name).toHaveProperty(name);
      expect(store.storeV1Examples, name).toHaveProperty(name);
    }
  });

  it("keeps pre-extension snapshots and legacy publication events readable", () => {
    const legacySnapshot: Record<string, unknown> = {
      ...store.storeV1Examples.StoreAuthoritativeSnapshotV1,
    };
    delete legacySnapshot.sellerAccess;
    expect(store.storeAuthoritativeSnapshotV1Contract.parse(legacySnapshot)).toEqual(
      legacySnapshot,
    );
    const legacyEvent = {
      ...store.storeV1Examples.StorePublishedV1,
      payload: {
        storeId: legacySnapshot.storeId,
        publicationStatus: "PUBLISHED",
      },
    };
    expect(store.storePublishedV1Contract.parse(legacyEvent)).toEqual(legacyEvent);
    expect(
      store.storeAuthoritativeSnapshotV1Contract.parse(legacySnapshot),
    ).not.toHaveProperty("sellerAccess");
  });

  it.each([
    [store.storePublishedV1Contract, store.storeV1Examples.StorePublishedV1],
    [store.storeUnpublishedV1Contract, store.storeV1Examples.StoreUnpublishedV1],
    [store.storePolicyChangedV1Contract, store.storeV1Examples.StorePolicyChangedV1],
  ])(
    "validates event versions, identity and the PII-free payload allow-list",
    (schema, example) => {
      expect(schema.safeParse(example).success).toBe(true);
      for (const invalid of [
        { ...example, version: 2 },
        { ...example, aggregateVersion: 0 },
        { ...example, actor: undefined },
        { ...example, eventId: "invalid" },
        { ...example, payload: { ...example.payload, storeId: "invalid" } },
        { ...example, payload: { ...example.payload, mobile: "PRIVATE" } },
        {
          ...example,
          payload: { ...example.payload, settlementDestination: "PRIVATE" },
        },
      ]) {
        expect(schema.safeParse(invalid).success).toBe(false);
      }
    },
  );

  it("keeps visual identity separate from purchase controls, trust and private metrics", () => {
    const snapshot = store.storeV1Examples.StoreAuthoritativeSnapshotV1;
    for (const forbidden of [
      "price",
      "inventory",
      "trust",
      "platformBrandingRequired",
    ]) {
      expect(
        store.storeAuthoritativeSnapshotV1Contract.safeParse({
          ...snapshot,
          displayIdentity: { ...snapshot.displayIdentity, [forbidden]: false },
        }).success,
      ).toBe(false);
    }
    const parsedInput = store.storeDraftInputContract.parse({
      name: "خانه سفال ماه",
      trust: { platformBrandingRequired: false },
      price: 0,
      inventory: 99,
    });
    expect(parsedInput).toEqual({ name: "خانه سفال ماه" });
    expect(
      store.publicStoreContract.safeParse({
        ...store.storeV1Examples.PublicStore,
        trust: { settlementStatus: "TEST_VERIFIED", platformBrandingRequired: false },
      }).success,
    ).toBe(false);
    expect(
      store.publicStoreContract.parse({
        ...store.storeV1Examples.PublicStore,
        owner: snapshot.owner,
        sellerAccess: { active: true },
        viewCount: 10,
        conversionRate: 0.2,
      }),
    ).toEqual(store.storeV1Examples.PublicStore);
  });

  it("does not reinterpret absent or inactive seller eligibility as an active grant", () => {
    expect(store.storeSellerAccessV1Contract.parse({ active: false })).toEqual({
      active: false,
    });
    for (const invalid of [
      {},
      { active: "true" },
      { active: true, status: "ACTIVE" },
    ]) {
      expect(store.storeSellerAccessV1Contract.safeParse(invalid).success).toBe(false);
    }
  });
});
