import { publicFollowerCountV1Contract } from "@sevo/contracts/discovery/v1";
import { identityStatusChangedV1Contract } from "@sevo/contracts/identity-access/v1";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { projectIdentityStatusForFollowerCount } from "../../apps/worker/src/modules/discovery";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const environment = {
  ...apiTestEnvironment,
  DEV_OTP_TEST_MOBILES: ["09123456789", "09123456788", "09123456787"],
};

describe("store following HTTP API with PostgreSQL", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`update identity_identities set status = 'ACTIVE'`;
    await sql`delete from discovery_follow_idempotency_records`;
    await sql`delete from discovery_store_follows`;
    await sql`delete from discovery_follow_sets`;
    await sql`delete from discovery_public_follower_counts`;
    await sql`delete from discovery_identity_status_projections`;
    await sql`delete from platform_outbox_events`;
    await sql`delete from store_idempotency_records`;
    await sql`delete from store_stores`;
    await sql`delete from identity_otp_challenges`;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function startApp() {
    const app = await createApiApp(environment);
    apps.push(app);
    return app;
  }

  it("uses only the valid session identity and composes viewer state for that viewer", async () => {
    const app = await startApp();
    const ownerCookie = await signIn(app, "09123456789");
    const buyerCookie = await signIn(app, "09123456788");
    const store = await publishStore(app, ownerCookie, "followed-store");
    const server = app.getHttpAdapter().getInstance();

    const unauthenticated = await server.inject({
      method: "PUT",
      url: `/v1/me/follows/${store.id}`,
      headers: { "idempotency-key": "guest-follow" },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const followed = await server.inject({
      method: "PUT",
      url: `/v1/me/follows/${store.id}?identityId=${store.ownerId}`,
      headers: { cookie: buyerCookie, "idempotency-key": "buyer-follow-1" },
      payload: { identityId: store.ownerId },
    });
    expect(followed.statusCode).toBe(200);
    expect(followed.headers.etag).toBe('"1"');
    expect(followed.json()).toMatchObject({
      version: 1,
      storeId: store.id,
      status: "ACTIVE",
      revision: 1,
      followSetRevision: 1,
    });
    expect(JSON.stringify(followed.json())).not.toMatch(/identity|mobile/i);

    const guestStore = await server.inject({
      method: "GET",
      url: "/v1/stores/followed-store",
    });
    const buyerStore = await server.inject({
      method: "GET",
      url: "/v1/stores/followed-store",
      headers: { cookie: buyerCookie },
    });
    expect(guestStore.json()).not.toHaveProperty("viewer");
    expect(guestStore.headers["cache-control"]).toContain("public");
    expect(guestStore.json()).toMatchObject({
      followerCount: { version: 1, storeId: store.id, count: 1 },
    });
    expect(buyerStore.json()).toMatchObject({
      viewer: { isFollowing: true, revision: 1 },
    });
    expect(buyerStore.headers.etag).toBe('"1"');
    expect(buyerStore.headers["cache-control"]).toBe("private, no-store");
    expect(
      publicFollowerCountV1Contract.safeParse(guestStore.json().followerCount).success,
    ).toBe(true);

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const [relation] = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId" from discovery_store_follows
      where store_id = ${store.id}
    `;
    const inactiveAt = "2026-08-24T09:30:00.000Z";
    const inactiveEvent = identityStatusChangedV1Contract.parse({
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: "IdentityStatusChanged.v1",
      aggregateId: relation!.identityId,
      aggregateVersion: 2,
      occurredAt: inactiveAt,
      correlationId: crypto.randomUUID(),
      causationId: crypto.randomUUID(),
      actor: { type: "SYSTEM" },
      payload: { status: "INACTIVE", statusVersion: 2 },
    });
    await sql.begin((transaction) =>
      projectIdentityStatusForFollowerCount(inactiveEvent, transaction),
    );
    const inactiveIdentityCount = await server.inject({
      method: "GET",
      url: "/v1/stores/followed-store",
    });
    expect(inactiveIdentityCount.json()).toMatchObject({
      followerCount: { count: 0, updatedAt: inactiveAt },
    });
    for (const statusVersion of [2, 1]) {
      await sql.begin((transaction) =>
        projectIdentityStatusForFollowerCount(
          {
            ...inactiveEvent,
            eventId: crypto.randomUUID(),
            aggregateVersion: statusVersion,
            payload: { status: "ACTIVE", statusVersion },
          },
          transaction,
        ),
      );
    }
    await sql.begin((transaction) =>
      projectIdentityStatusForFollowerCount(
        {
          ...inactiveEvent,
          eventId: crypto.randomUUID(),
          aggregateVersion: 3,
          occurredAt: "2026-08-24T09:45:00.000Z",
          payload: { status: "INACTIVE", statusVersion: 3 },
        },
        transaction,
      ),
    );
    const [stableProjection] = await sql<Array<{ count: number; updatedAt: Date }>>`
      select follower_count as count, updated_at as "updatedAt"
      from discovery_public_follower_counts where store_id = ${store.id}
    `;
    expect(stableProjection).toEqual({ count: 0, updatedAt: new Date(inactiveAt) });
    await sql.end();
  });

  it("makes duplicate and retry writes idempotent and rejects stale revisions", async () => {
    const app = await startApp();
    const ownerCookie = await signIn(app, "09123456789");
    const buyerCookie = await signIn(app, "09123456788");
    const store = await publishStore(app, ownerCookie, "idempotent-follow-store");
    const server = app.getHttpAdapter().getInstance();
    const firstHeaders = {
      cookie: buyerCookie,
      "idempotency-key": "activate-follow-1",
    };

    const [first, retry] = await Promise.all([
      server.inject({
        method: "PUT",
        url: `/v1/me/follows/${store.id}`,
        headers: firstHeaders,
      }),
      server.inject({
        method: "PUT",
        url: `/v1/me/follows/${store.id}`,
        headers: firstHeaders,
      }),
    ]);
    const duplicate = await server.inject({
      method: "PUT",
      url: `/v1/me/follows/${store.id}`,
      headers: {
        cookie: buyerCookie,
        "idempotency-key": "activate-follow-duplicate",
        "if-match": '"1"',
      },
    });

    expect(first.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(duplicate.json()).toEqual(first.json());

    const missingPrecondition = await server.inject({
      method: "DELETE",
      url: `/v1/me/follows/${store.id}`,
      headers: { cookie: buyerCookie, "idempotency-key": "delete-without-tag" },
    });
    expect(missingPrecondition.statusCode).toBe(428);

    const stale = await server.inject({
      method: "DELETE",
      url: `/v1/me/follows/${store.id}`,
      headers: {
        cookie: buyerCookie,
        "idempotency-key": "delete-stale",
        "if-match": '"0"',
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "REVISION_CONFLICT",
      details: { currentRevision: 1 },
    });

    const removedHeaders = {
      cookie: buyerCookie,
      "idempotency-key": "deactivate-follow-1",
      "if-match": '"1"',
    };
    const removed = await server.inject({
      method: "DELETE",
      url: `/v1/me/follows/${store.id}`,
      headers: removedHeaders,
    });
    const removedRetry = await server.inject({
      method: "DELETE",
      url: `/v1/me/follows/${store.id}`,
      headers: removedHeaders,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ status: "INACTIVE", revision: 2 });
    expect(removedRetry.json()).toEqual(removed.json());

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const [count] = await sql<Array<{ count: number }>>`
      select follower_count as count from discovery_public_follower_counts
      where store_id = ${store.id}
    `;
    const events = await sql<
      Array<{ eventType: string; payload: unknown; causationId: string | null }>
    >`
      select event_type as "eventType", payload,
        causation_id as "causationId"
      from platform_outbox_events
      where payload->>'storeId' = ${store.id}
        and event_type in ('StoreFollowActivated.v1', 'StoreFollowDeactivated.v1')
      order by aggregate_version
    `;
    expect(count).toEqual({ count: 0 });
    expect(events.map(({ eventType }) => eventType)).toEqual([
      "StoreFollowActivated.v1",
      "StoreFollowDeactivated.v1",
    ]);
    expect(JSON.stringify(events)).not.toMatch(/identity|mobile/i);
    expect(events.every(({ causationId }) => causationId !== null)).toBe(true);

    await sql.end();
  });

  it("does not lose concurrent follows from different identities", async () => {
    const app = await startApp();
    const ownerCookie = await signIn(app, "09123456789");
    const firstBuyerCookie = await signIn(app, "09123456788");
    const secondBuyerCookie = await signIn(app, "09123456787");
    const store = await publishStore(app, ownerCookie, "concurrent-follow-store");
    const server = app.getHttpAdapter().getInstance();

    const responses = await Promise.all(
      [firstBuyerCookie, secondBuyerCookie].map((cookie, index) =>
        server.inject({
          method: "PUT",
          url: `/v1/me/follows/${store.id}`,
          headers: {
            cookie,
            "idempotency-key": `concurrent-buyer-${index}`,
          },
        }),
      ),
    );
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200]);

    const publicStore = await server.inject({
      method: "GET",
      url: "/v1/stores/concurrent-follow-store",
    });
    expect(publicStore.json()).toMatchObject({ followerCount: { count: 2 } });
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const [projection] = await sql<Array<{ count: number }>>`
      select follower_count as count from discovery_public_follower_counts
      where store_id = ${store.id}
    `;
    expect(projection).toEqual({ count: 2 });
    await sql.end();
  });

  it("rejects self-following and unpublished stores without revealing them", async () => {
    const app = await startApp();
    const ownerCookie = await signIn(app, "09123456789");
    const published = await publishStore(app, ownerCookie, "owners-store");
    const server = app.getHttpAdapter().getInstance();

    const publicStore = await server.inject({
      method: "GET",
      url: "/v1/stores/owners-store",
    });
    expect(publicStore.json()).toMatchObject({ followerCount: { count: 0 } });
    const countSql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const countRows = await countSql`
      select store_id from discovery_public_follower_counts
      where store_id = ${published.id}
    `;
    expect(countRows).toHaveLength(0);
    await countSql.end();

    const selfFollow = await server.inject({
      method: "PUT",
      url: `/v1/me/follows/${published.id}`,
      headers: { cookie: ownerCookie, "idempotency-key": "self-follow" },
    });
    expect(selfFollow.statusCode).toBe(422);
    expect(selfFollow.json()).toMatchObject({ code: "SELF_FOLLOW_NOT_ALLOWED" });

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const draftStoreId = crypto.randomUUID();
    await sql`
      insert into store_stores (id, name, slug, status, revision, updated_at)
      values (${draftStoreId}, 'پیش‌نویس', 'private-store', 'DRAFT', 1, now())
    `;
    await sql.end();
    const privateFollow = await server.inject({
      method: "PUT",
      url: `/v1/me/follows/${draftStoreId}`,
      headers: { cookie: ownerCookie, "idempotency-key": "private-follow" },
    });
    expect(privateFollow.statusCode).toBe(404);
    expect(privateFollow.json()).toMatchObject({ code: "STORE_NOT_FOUND" });
  });
});

async function signIn(app: Awaited<ReturnType<typeof createApiApp>>, mobile: string) {
  const server = app.getHttpAdapter().getInstance();
  const requested = await server.inject({
    method: "POST",
    url: "/v1/auth/otp/requests",
    payload: { mobile },
  });
  const verified = await server.inject({
    method: "POST",
    url: "/v1/auth/otp/verifications",
    payload: {
      challengeId: requested.json<{ challengeId: string }>().challengeId,
      code: "111111",
    },
  });
  return verified.headers["set-cookie"]!;
}

async function publishStore(
  app: Awaited<ReturnType<typeof createApiApp>>,
  cookie: string,
  slug: string,
) {
  const server = app.getHttpAdapter().getInstance();
  const session = await server.inject({
    method: "GET",
    url: "/v1/auth/session",
    headers: { cookie },
  });
  const ownerId = session.json<{ actor: { identityId: string } }>().actor.identityId;
  const saved = await server.inject({
    method: "PUT",
    url: "/v1/seller/store/draft",
    headers: { cookie, "idempotency-key": `save-${slug}`, "if-match": '"0"' },
    payload: {
      name: "خانه سفال ماه",
      slug,
      bio: "سفال دست‌ساز برای خانه‌های گرم و ساده",
      shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
      returnPolicy: "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.",
      settlementDestination: { kind: "TEST" },
      logoMediaId: null,
      coverMediaId: null,
      themeColor: "#A41439",
    },
  });
  const published = await server.inject({
    method: "POST",
    url: "/v1/seller/store/publication",
    headers: {
      cookie,
      "idempotency-key": `publish-${slug}`,
      "if-match": `"${saved.json<{ revision: number }>().revision}"`,
    },
  });
  return {
    id: published.json<{ store: { id: string } }>().store.id,
    ownerId,
  };
}
