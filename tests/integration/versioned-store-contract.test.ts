import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { DiscoveryStoreContractConsumer } from "../../apps/api/src/modules/discovery/store-contract.consumer";
import { ProductStoreContractConsumer } from "../../apps/api/src/modules/product/store-contract.consumer";
import {
  STORE_AUTHORITATIVE_READ,
  type StoreAuthoritativeRead,
} from "../../apps/api/src/modules/store/public";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("versioned Store contract with PostgreSQL", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from identity_otp_challenges where mobile = '09123456789'`;
    await sql`delete from store_idempotency_records`;
    await sql`delete from store_stores`;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function startApp() {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    return app;
  }

  async function signIn(app: Awaited<ReturnType<typeof startApp>>) {
    const server = app.getHttpAdapter().getInstance();
    const requested = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "09123456789" },
    });
    const challengeId = requested.json<{ challengeId: string }>().challengeId;
    const verified = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId, code: "111111" },
    });
    return verified.headers["set-cookie"]!;
  }

  it("replays writes once and rejects stale revisions or changed payloads", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const payload = completeStore("versioned-store");
    const headers = {
      cookie,
      "idempotency-key": "save-versioned-store-1",
      "if-match": '"0"',
    };

    const first = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers,
      payload,
    });
    const replay = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ revision: 1, returnPolicyRevision: 1 });
    expect(first.headers.etag).toBe('"1"');
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());

    const conflictingReplay = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers,
      payload: { ...payload, name: "نام دیگر" },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const stale = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: {
        cookie,
        "idempotency-key": "save-versioned-store-stale",
        "if-match": '"0"',
      },
      payload: { name: "نام تازه" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "STORE_REVISION_CONFLICT",
      details: { expectedRevision: 0, currentRevision: 1 },
    });
  });

  it("publishes one versioned event and keeps the public query allow-listed", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const saved = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: {
        cookie,
        "idempotency-key": "save-public-store-1",
        "if-match": '"0"',
      },
      payload: completeStore("public-versioned-store"),
    });
    const publicationHeaders = {
      cookie,
      "idempotency-key": "publish-public-store-1",
      "if-match": `"${saved.json<{ revision: number }>().revision}"`,
    };
    const published = await server.inject({
      method: "POST",
      url: "/v1/seller/store/publication",
      headers: publicationHeaders,
    });
    const replay = await server.inject({
      method: "POST",
      url: "/v1/seller/store/publication",
      headers: publicationHeaders,
    });

    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      store: {
        revision: 2,
        publicationVersion: 1,
        returnPolicyRevision: 1,
        shippingMethods: [
          {
            revision: 1,
            fixedFee: { amount: 0, currency: "IRR" },
            requiresDeliveryAddress: true,
            requiresPostalCode: true,
          },
        ],
      },
    });
    expect(replay.json()).toEqual(published.json());

    const storeId = (published.json() as { store: { id: string } }).store.id as never;
    const stores = app.get<StoreAuthoritativeRead>(STORE_AUTHORITATIVE_READ);
    const authoritative = await stores.readStore(storeId);
    const productStore = await new ProductStoreContractConsumer(
      stores,
    ).requireProductPublicationStore(authoritative!.owner.identityId, storeId);
    const discoveryStore = await new DiscoveryStoreContractConsumer(
      stores,
    ).readPublishedStore(storeId);
    expect(productStore).toEqual({
      storeId,
      storeRevision: 2,
      publicationVersion: 1,
    });
    expect(discoveryStore).toMatchObject({
      storeId,
      publicationStatus: "PUBLISHED",
      slug: "public-versioned-store",
    });

    const publicRead = await server.inject({
      method: "GET",
      url: "/v1/stores/public-versioned-store",
    });
    const publicBody = publicRead.json<Record<string, unknown>>();
    expect(publicRead.statusCode).toBe(200);
    expect(publicBody).not.toHaveProperty("owner");
    expect(publicBody).toMatchObject({
      settlementDestination: { kind: "TEST", status: "TEST_VERIFIED" },
    });
    expect(JSON.stringify(publicBody)).not.toMatch(
      /view|like|save|share|conversion|cart|growth/i,
    );

    const edited = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: {
        cookie,
        "idempotency-key": "edit-public-store-policy-1",
        "if-match": '"2"',
      },
      payload: {
        returnPolicy: "تا چهارده روز پس از تحویل امکان درخواست مرجوعی وجود دارد.",
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      status: "DRAFT",
      revision: 3,
      publicationVersion: 1,
      returnPolicyRevision: 2,
    });

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const events = await sql<
      Array<{ eventType: string; payload: Record<string, unknown> }>
    >`
      select event_type as "eventType", payload from platform_outbox_events
      where aggregate_id = ${(published.json() as { store: { id: string } }).store.id}
      order by created_at, event_type
    `;
    await sql.end();
    expect(events).toEqual(
      expect.arrayContaining([
        {
          eventType: "StorePublished.v1",
          payload: expect.objectContaining({
            publicationStatus: "PUBLISHED",
            publicationVersion: 1,
          }),
        },
        {
          eventType: "StoreUnpublished.v1",
          payload: expect.objectContaining({
            publicationStatus: "DRAFT",
            publicationVersion: 1,
          }),
        },
        {
          eventType: "StorePolicyChanged.v1",
          payload: expect.objectContaining({
            returnPolicyRevision: 2,
            shippingMethods: [expect.objectContaining({ revision: 1 })],
          }),
        },
      ]),
    );
    expect(
      events.filter(({ eventType }) => eventType === "StorePublished.v1"),
    ).toHaveLength(1);
    expect(JSON.stringify(events)).not.toMatch(
      /mobile|address|returnPolicyText|settlementDestination/i,
    );
  });
});

function completeStore(slug: string) {
  return {
    name: "خانه سفال ماه",
    slug,
    bio: "سفال دست‌ساز برای خانه‌های گرم و ساده",
    shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
    returnPolicy: "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.",
    settlementDestination: { kind: "TEST" },
    logoMediaId: null,
    coverMediaId: null,
    themeColor: "#A41439",
  };
}
