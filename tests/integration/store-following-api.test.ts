import {
  discoveryFeedProjectionEventTypes,
  publicFollowerCountV1Contract,
  storeFollowActivatedV1Contract,
} from "@sevo/contracts/discovery/v1";
import { identityStatusChangedV1Contract } from "@sevo/contracts/identity-access/v1";
import { DurableOutboxWorker, enqueueOutboxEvent } from "@sevo/outbox";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import {
  discoveryFollowerCountOutboxHandlers,
  projectIdentityStatusForFollowerCount,
  rebuildDiscoveryFollowerCountProjection,
} from "../../apps/worker/src/modules/discovery";
import { apiTestEnvironment } from "../helpers/api-test-environment";
import { drainFollowerCountEvents } from "../helpers/drain-follower-count-events";

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
    await sql`delete from discovery_follower_count_relation_projections`;
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

    await projectFollowerCountEvents();

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

    await projectFollowerCountEvents();

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

    await projectFollowerCountEvents();

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

  it("does not publish a follower count before the follow event is projected", async () => {
    const app = await startApp();
    const ownerCookie = await signIn(app, "09123456789");
    const buyerCookie = await signIn(app, "09123456788");
    const store = await publishStore(app, ownerCookie, "eventual-follow-count");
    const server = app.getHttpAdapter().getInstance();

    const followed = await server.inject({
      method: "PUT",
      url: `/v1/me/follows/${store.id}`,
      headers: {
        cookie: buyerCookie,
        "idempotency-key": "eventual-follow-count-1",
      },
    });
    expect(followed.statusCode).toBe(200);

    const publicStore = await server.inject({
      method: "GET",
      url: "/v1/stores/eventual-follow-count",
    });
    expect(publicStore.json()).toMatchObject({ followerCount: { count: 0 } });

    await projectFollowerCountEvents();
    const projectedStore = await server.inject({
      method: "GET",
      url: "/v1/stores/eventual-follow-count",
    });
    expect(projectedStore.json()).toMatchObject({ followerCount: { count: 1 } });
  });

  it("rebuilds the public follower count from the complete durable event history", async () => {
    const app = await startApp();
    const ownerCookie = await signIn(app, "09123456789");
    const firstBuyerCookie = await signIn(app, "09123456788");
    const secondBuyerCookie = await signIn(app, "09123456787");
    const store = await publishStore(app, ownerCookie, "rebuilt-follow-count");
    const server = app.getHttpAdapter().getInstance();

    for (const [index, cookie] of [firstBuyerCookie, secondBuyerCookie].entries()) {
      const followed = await server.inject({
        method: "PUT",
        url: `/v1/me/follows/${store.id}`,
        headers: {
          cookie,
          "idempotency-key": `rebuild-follow-count-${index}`,
        },
      });
      expect(followed.statusCode).toBe(200);
    }
    await projectFollowerCountEvents();

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const [firstRelation] = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId"
      from discovery_store_follows
      where store_id = ${store.id}
      order by activated_at
      limit 1
    `;
    const inactiveEvent = identityStatusChangedV1Contract.parse({
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: "IdentityStatusChanged.v1",
      aggregateId: firstRelation!.identityId,
      aggregateVersion: 1,
      occurredAt: new Date().toISOString(),
      correlationId: crypto.randomUUID(),
      causationId: crypto.randomUUID(),
      actor: { type: "SYSTEM" },
      payload: { status: "INACTIVE", statusVersion: 1 },
    });
    await sql.begin((transaction) => enqueueOutboxEvent(transaction, inactiveEvent));
    await sql.end();
    await projectFollowerCountEvents();

    const damaged = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await damaged`delete from discovery_identity_status_projections`;
    await damaged`delete from discovery_public_follower_counts`;
    await damaged`delete from discovery_follower_count_relation_projections`;
    await damaged.end();

    const rebuilt = await rebuildDiscoveryFollowerCountProjection(
      apiTestEnvironment.DATABASE_URL,
    );
    expect(rebuilt.replayedEventCount).toBe(3);
    const publicStore = await server.inject({
      method: "GET",
      url: "/v1/stores/rebuilt-follow-count",
    });
    expect(publicStore.json()).toMatchObject({ followerCount: { count: 1 } });
  });

  it("treats a first inactive identity event as a zero-to-zero transition", async () => {
    const identityId = crypto.randomUUID();
    const storeId = crypto.randomUUID();
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`
      insert into discovery_follower_count_relation_projections
        (relation_id, identity_id, store_id, status, relation_revision, updated_at)
      values
        (${crypto.randomUUID()}, ${identityId}, ${storeId}, 'ACTIVE', 1, now())
    `;
    const inactiveEvent = identityStatusChangedV1Contract.parse({
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: "IdentityStatusChanged.v1",
      aggregateId: identityId,
      aggregateVersion: 1,
      occurredAt: new Date().toISOString(),
      correlationId: crypto.randomUUID(),
      causationId: crypto.randomUUID(),
      actor: { type: "SYSTEM" },
      payload: { status: "INACTIVE", statusVersion: 1 },
    });

    await expect(
      sql.begin((transaction) =>
        projectIdentityStatusForFollowerCount(inactiveEvent, transaction),
      ),
    ).resolves.toBeUndefined();
    const counts = await sql`
      select follower_count from discovery_public_follower_counts
      where store_id = ${storeId}
    `;
    expect(counts).toHaveLength(0);
    await sql.end();
  });

  it("rolls back a follower-count projection when its relation is missing", async () => {
    const relationId = crypto.randomUUID();
    const storeId = crypto.randomUUID();
    const event = storeFollowActivatedV1Contract.parse({
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: "StoreFollowActivated.v1",
      aggregateId: relationId,
      aggregateVersion: 1,
      occurredAt: new Date().toISOString(),
      correlationId: crypto.randomUUID(),
      causationId: crypto.randomUUID(),
      actor: { type: "SYSTEM" },
      payload: { storeId, relationRevision: 1, followSetRevision: 1 },
    });
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql.begin((transaction) => enqueueOutboxEvent(transaction, event));
    await sql.end();

    const worker = new DurableOutboxWorker(apiTestEnvironment.DATABASE_URL, {
      consumerName: "discovery-follower-count-v1",
      handlers: discoveryFollowerCountOutboxHandlers,
      maxAttempts: 1,
      retryDelaysMs: [0],
      log: () => undefined,
    });
    try {
      expect(await worker.runOnce()).toBe("failed");
    } finally {
      await worker.close();
    }

    const verification = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const [receipt, count, storedEvent] = await Promise.all([
      verification`
        select event_id from platform_outbox_consumptions
        where consumer_name = 'discovery-follower-count-v1'
          and event_id = ${event.eventId}
      `,
      verification`
        select store_id from discovery_public_follower_counts
        where store_id = ${storeId}
      `,
      verification<Array<{ status: string }>>`
        select status from platform_outbox_events where event_id = ${event.eventId}
      `,
    ]);
    expect(receipt).toHaveLength(0);
    expect(count).toHaveLength(0);
    expect(storedEvent).toEqual([{ status: "FAILED" }]);
    await verification.end();
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

  it("invalidates following-feed pagination after the signed-in buyer follows or unfollows", async () => {
    const app = await startApp();
    const ownerCookie = await signIn(app, "09123456789");
    const buyerCookie = await signIn(app, "09123456788");
    const secondOwnerCookie = await signIn(app, "09123456787");
    const store = await publishStore(app, ownerCookie, "following-feed-store");
    const secondStore = await publishStore(
      app,
      secondOwnerCookie,
      "following-feed-second-store",
    );
    const server = app.getHttpAdapter().getInstance();
    const productIds = await seedFollowingFeedProducts(store.id);
    const secondProductIds = await seedFollowingFeedProducts(secondStore.id);

    const guest = await server.inject({
      method: "GET",
      url: "/v1/me/feeds/following",
    });
    expect(guest.statusCode).toBe(401);

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`
      update identity_identities
      set status = 'INACTIVE'
      where id = (
        select identity_id from identity_login_methods where mobile = '09123456788'
      )
    `;
    const inactive = await server.inject({
      method: "GET",
      url: "/v1/me/feeds/following",
      headers: { cookie: buyerCookie },
    });
    expect(inactive.statusCode).toBe(403);
    expect(inactive.json()).toMatchObject({ code: "IDENTITY_INACTIVE" });
    await sql`update identity_identities set status = 'ACTIVE'`;
    await sql.end();

    const followed = await server.inject({
      method: "PUT",
      url: `/v1/me/follows/${store.id}?identityId=${store.ownerId}`,
      headers: { cookie: buyerCookie, "idempotency-key": "feed-follow" },
      payload: { identityId: store.ownerId },
    });
    expect(followed.statusCode).toBe(200);

    const first = await server.inject({
      method: "GET",
      url: `/v1/me/feeds/following?limit=1&identityId=${store.ownerId}`,
      headers: { cookie: buyerCookie },
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(first.headers).toHaveProperty("x-projection-lag-ms");
    expect(first.json()).toMatchObject({
      visibleFollowedStoreCount: 1,
      followSetRevision: 1,
      items: [{ productId: productIds[1] }],
    });
    expect(first.json()).toHaveProperty("nextCursor");
    expect(JSON.stringify(first.json())).not.toMatch(/identity|score|like|viewCount/i);

    const second = await server.inject({
      method: "GET",
      url: `/v1/me/feeds/following?limit=1&cursor=${encodeURIComponent(
        first.json().nextCursor,
      )}`,
      headers: { cookie: buyerCookie },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ items: [{ productId: productIds[0] }] });
    expect(second.json()).not.toHaveProperty("nextCursor");

    const removed = await server.inject({
      method: "DELETE",
      url: `/v1/me/follows/${store.id}`,
      headers: {
        cookie: buyerCookie,
        "idempotency-key": "feed-unfollow",
        "if-match": '"1"',
      },
    });
    expect(removed.statusCode).toBe(200);

    const stale = await server.inject({
      method: "GET",
      url: `/v1/me/feeds/following?limit=1&cursor=${encodeURIComponent(
        first.json().nextCursor,
      )}`,
      headers: { cookie: buyerCookie },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "FEED_CURSOR_STALE" });

    const reactivated = await server.inject({
      method: "PUT",
      url: `/v1/me/follows/${store.id}`,
      headers: {
        cookie: buyerCookie,
        "idempotency-key": "feed-refollow",
        "if-match": '"2"',
      },
    });
    expect(reactivated.statusCode).toBe(200);
    const beforeAnotherFollow = await server.inject({
      method: "GET",
      url: "/v1/me/feeds/following?limit=1",
      headers: { cookie: buyerCookie },
    });
    expect(beforeAnotherFollow.statusCode).toBe(200);
    expect(beforeAnotherFollow.json()).toHaveProperty("nextCursor");

    const anotherFollow = await server.inject({
      method: "PUT",
      url: `/v1/me/follows/${secondStore.id}`,
      headers: { cookie: buyerCookie, "idempotency-key": "feed-follow-second" },
    });
    expect(anotherFollow.statusCode).toBe(200);
    const staleAfterFollow = await server.inject({
      method: "GET",
      url: `/v1/me/feeds/following?limit=1&cursor=${encodeURIComponent(
        beforeAnotherFollow.json().nextCursor,
      )}`,
      headers: { cookie: buyerCookie },
    });
    expect(staleAfterFollow.statusCode).toBe(409);
    expect(staleAfterFollow.json()).toMatchObject({ code: "FEED_CURSOR_STALE" });

    const storesById = [
      { storeId: store.id, productIds },
      { storeId: secondStore.id, productIds: secondProductIds },
    ].sort((left, right) => left.storeId.localeCompare(right.storeId));
    const expectedOrder = [
      ...storesById.map(({ productIds: ids }) => ids[1]),
      ...storesById.map(({ productIds: ids }) => ids[0]),
    ];
    const roundRobinFirst = await server.inject({
      method: "GET",
      url: "/v1/me/feeds/following?limit=2",
      headers: { cookie: buyerCookie },
    });
    expect(roundRobinFirst.statusCode).toBe(200);
    expect(
      roundRobinFirst.json().items.map((item: { productId: string }) => item.productId),
    ).toEqual(expectedOrder.slice(0, 2));
    expect(roundRobinFirst.json()).toHaveProperty("nextCursor");

    const roundRobinSecond = await server.inject({
      method: "GET",
      url: `/v1/me/feeds/following?limit=2&cursor=${encodeURIComponent(
        roundRobinFirst.json().nextCursor,
      )}`,
      headers: { cookie: buyerCookie },
    });
    expect(roundRobinSecond.statusCode).toBe(200);
    expect(
      roundRobinSecond
        .json()
        .items.map((item: { productId: string }) => item.productId),
    ).toEqual(expectedOrder.slice(2));
    expect(roundRobinSecond.json()).not.toHaveProperty("nextCursor");
  });
});

async function seedFollowingFeedProducts(storeId: string) {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const products = [0, 1].map((position) => ({
    productId: crypto.randomUUID(),
    variantId: crypto.randomUUID(),
    mediaId: crypto.randomUUID(),
    publishedAt: `2026-08-${23 + position}T10:00:00.000Z`,
  }));
  await sql`
    insert into discovery_store_feed_projections
      (store_id, published, aggregate_version, publication_version, updated_at)
    values (${storeId}, true, 2, 1, now())
  `;
  for (const [position, product] of products.entries()) {
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at,
         created_at, updated_at)
      values (${product.productId}, ${storeId}, 'PUBLISHED', 2, 1,
        ${product.publishedAt}, ${product.publishedAt}, ${product.publishedAt})
    `;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id, variant_id)
      values (${product.productId}, 1, ${`فنجان ${position + 1}`},
        'فنجان دست‌ساز', ${product.mediaId}, ${product.variantId})
    `;
    await sql`
      insert into product_offers (product_id, variant_id, amount, currency, revision)
      values (${product.productId}, ${product.variantId}, ${1_000_000 + position * 10},
        'IRR', 1)
    `;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${product.variantId}, ${storeId}, 5, 1)
    `;
    await sql`
      insert into discovery_product_feed_projections
        (product_id, store_id, product_aggregate_version, publication_version,
         published, first_published_at, eligible_since, offer_version,
         availability_version, publication_updated_at, updated_at)
      values (${product.productId}, ${storeId}, 2, 1, true,
        ${product.publishedAt}, ${product.publishedAt}, 1, 1,
        ${product.publishedAt}, now())
    `;
  }
  await sql`
    insert into platform_outbox_consumptions (consumer_name, event_id, consumed_at)
    select 'discovery-public-feed-v1', event_id, now()
    from platform_outbox_events
    where event_type in ${sql(discoveryFeedProjectionEventTypes)}
    on conflict (consumer_name, event_id) do nothing
  `;
  await sql`
    update discovery_projection_status
    set healthy = true, reason = null, updated_at = now()
    where projection_name = 'public-feed-v1'
  `;
  await sql.end();
  return products.map(({ productId }) => productId);
}

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

async function projectFollowerCountEvents() {
  await drainFollowerCountEvents(apiTestEnvironment.DATABASE_URL);
}
