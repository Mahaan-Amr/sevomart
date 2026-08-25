import { randomUUID } from "node:crypto";

import { storePublishedV1Contract } from "@sevo/contracts/store/v1";
import { eventEnvelopeV1Contract } from "@sevo/contracts/platform/v1";
import {
  catchUpOutboxConsumer,
  DurableOutboxWorker,
  enqueueOutboxEvent,
  readOutboxConsumerBacklog,
  replayOutboxEventHistory,
  type OutboxEventHandler,
} from "@sevo/outbox";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { PostgresStoreRepository } from "../../apps/api/src/modules/store/composition";
import { projectStorePublication } from "../../apps/worker/src/modules/reporting-analytics/index";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("durable outbox worker", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];
  const workers: DurableOutboxWorker[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from store_idempotency_records`;
    await sql`delete from store_stores`;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
  });

  it("commits store publication and its versioned outbox event together", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const cookie = await signIn(server);
    const correlationId = randomUUID();

    await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: storeWriteHeaders(cookie, 0),
      payload: {
        name: "خانه رخداد",
        slug: "integration-outbox-store",
        bio: "فروشگاه آزمایشی برای مسیر پایدار رخداد",
        shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
        returnPolicy: "تا هفت روز امکان درخواست مرجوعی وجود دارد.",
        settlementDestination: { kind: "TEST" },
      },
    });

    const publication = await server.inject({
      method: "POST",
      url: "/v1/seller/store/publication",
      headers: {
        ...storeWriteHeaders(cookie, 1),
        "x-correlation-id": correlationId,
      },
    });
    expect(publication.statusCode).toBe(200);

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const events = await sql<
      Array<{
        eventType: string;
        aggregateVersion: number;
        correlationId: string;
        actorType: string;
        actorId: string;
        payload: Record<string, unknown>;
      }>
    >`
      select event_type as "eventType", aggregate_version as "aggregateVersion",
        correlation_id as "correlationId", actor_type as "actorType",
        actor_id as "actorId", payload
      from platform_outbox_events
      where correlation_id = ${correlationId}::uuid
    `;
    await sql.end();

    expect(events).toEqual([
      {
        eventType: "StorePublished.v1",
        aggregateVersion: expect.any(Number),
        correlationId,
        actorType: "IDENTITY",
        actorId: expect.any(String),
        payload: {
          storeId: publication.json<{ store: { id: string } }>().store.id,
          publicationStatus: "PUBLISHED",
          publicationVersion: 1,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/mobile|name|bio/i);
  });

  it("rolls back the store change when its outbox insert cannot commit", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const cookie = await signIn(server);
    const slug = `atomic-${randomUUID().slice(0, 8)}`;
    const saved = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: storeWriteHeaders(cookie, 0),
      payload: {
        name: "خانه اتمیک",
        slug,
        bio: "فروشگاه آزمایشی برای rollback رخداد",
        shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
        returnPolicy: "تا هفت روز امکان درخواست مرجوعی وجود دارد.",
        settlementDestination: { kind: "TEST" },
      },
    });
    expect(saved.statusCode).toBe(200);
    const storeId = saved.json<{ id: string }>().id;

    const duplicateEventId = randomUUID();
    const existingEvent = {
      ...eventEnvelopeV1Contract.parse({
        version: 1,
        eventId: duplicateEventId,
        eventType: "OutboxAtomicityProbe.v1",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        actor: { type: "SYSTEM" },
      }),
      payload: { probe: true },
    };
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await enqueueOutboxEvent(sql, existingEvent);
    const memberships = await sql<Array<{ sellerId: string }>>`
      select seller_id as "sellerId" from store_memberships
      where store_id = ${storeId}::uuid and role = 'OWNER'
    `;
    await sql.end();

    const repository = new PostgresStoreRepository(
      apiTestEnvironment.DATABASE_URL,
      () => duplicateEventId,
    );
    await expect(
      repository.publish(storeId, new Date(), {
        operation: "PUBLISH_STORE",
        correlationId: randomUUID(),
        actorId: memberships[0]!.sellerId,
        idempotencyKey: randomUUID(),
        requestHash: "0".repeat(64),
        expectedRevision: 1,
      }),
    ).rejects.toThrow();
    await repository.onModuleDestroy();

    const inspect = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const rows = await inspect<Array<{ status: string; publicationVersion: number }>>`
      select status, publication_version as "publicationVersion"
      from store_stores where id = ${storeId}::uuid
    `;
    await inspect.end();
    expect(rows).toEqual([{ status: "DRAFT", publicationVersion: expect.any(Number) }]);
  });

  it("turns concurrent duplicate publication into one transition and one event", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const cookie = await signIn(server);
    const saved = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: storeWriteHeaders(cookie, 0),
      payload: {
        name: "خانه هم‌زمان",
        slug: `concurrent-${randomUUID().slice(0, 8)}`,
        bio: "فروشگاه آزمایشی برای انتشار هم‌زمان",
        shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
        returnPolicy: "تا هفت روز امکان درخواست مرجوعی وجود دارد.",
        settlementDestination: { kind: "TEST" },
      },
    });
    expect(saved.statusCode).toBe(200);
    const storeId = saved.json<{ id: string }>().id;
    const inspect = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const memberships = await inspect<Array<{ sellerId: string }>>`
      select seller_id as "sellerId" from store_memberships
      where store_id = ${storeId}::uuid and role = 'OWNER'
    `;
    const actorId = memberships[0]!.sellerId;
    const correlationIds = [randomUUID(), randomUUID()] as const;
    const idempotencyKey = randomUUID();
    const repositories = [
      new PostgresStoreRepository(apiTestEnvironment.DATABASE_URL),
      new PostgresStoreRepository(apiTestEnvironment.DATABASE_URL),
    ];

    const results = await Promise.all(
      repositories.map((repository, index) =>
        repository.publish(storeId, new Date(), {
          operation: "PUBLISH_STORE",
          correlationId: correlationIds[index]!,
          actorId,
          idempotencyKey,
          requestHash: "0".repeat(64),
          expectedRevision: 1,
        }),
      ),
    );
    await Promise.all(repositories.map((repository) => repository.onModuleDestroy()));

    const events = await inspect<Array<{ count: number }>>`
      select count(*)::int as count from platform_outbox_events
      where correlation_id = ${correlationIds[0]}::uuid
         or correlation_id = ${correlationIds[1]}::uuid
    `;
    await inspect.end();
    expect(results.map((result) => result.status)).toEqual(["PUBLISHED", "PUBLISHED"]);
    expect(events).toEqual([{ count: 1 }]);
  });

  it("retries a transient failure with backoff and eventually acknowledges it", async () => {
    const event = {
      ...eventEnvelopeV1Contract.parse({
        version: 1,
        eventId: randomUUID(),
        eventType: "OutboxRetryProbe.v1",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        occurredAt: "2026-08-23T12:00:00+03:30",
        correlationId: randomUUID(),
        actor: { type: "SYSTEM" },
      }),
      payload: { probe: true },
    };
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await enqueueOutboxEvent(sql, event);
    await sql.end();

    let attempts = 0;
    let now = new Date("2026-08-23T12:00:00+03:30");
    const handler: OutboxEventHandler = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary projection failure");
    };
    const worker = new DurableOutboxWorker(apiTestEnvironment.DATABASE_URL, {
      consumerName: "retry-integration-test",
      handlers: { "OutboxRetryProbe.v1": handler },
      now: () => now,
      retryDelaysMs: [1_000],
      maxAttempts: 3,
    });
    workers.push(worker);

    expect(await worker.runOnce()).toBe("retry");
    now = new Date(now.getTime() + 999);
    expect(await worker.runOnce()).toBe("idle");
    now = new Date(now.getTime() + 1);
    expect(await worker.runOnce()).toBe("processed");
    expect(attempts).toBe(2);

    const inspect = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const rows = await inspect<
      Array<{ status: string; attemptCount: number; lastError: string | null }>
    >`
      select status, attempt_count as "attemptCount", last_error as "lastError"
      from platform_outbox_events where event_id = ${event.eventId}::uuid
    `;
    await inspect.end();
    expect(rows).toEqual([{ status: "PROCESSED", attemptCount: 2, lastError: null }]);
  });

  it("recovers an expired lease after restart without applying the domain result twice", async () => {
    const event = storePublishedV1Contract.parse({
      version: 1,
      eventId: randomUUID(),
      eventType: "StorePublished.v1",
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      occurredAt: "2026-08-23T12:00:00+03:30",
      correlationId: randomUUID(),
      actor: { type: "SYSTEM" },
      payload: { storeId: randomUUID(), publicationStatus: "PUBLISHED" },
    });
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await enqueueOutboxEvent(sql, event);
    await sql.end();

    let now = new Date("2026-08-23T12:00:00+03:30");
    const firstWorker = new DurableOutboxWorker(apiTestEnvironment.DATABASE_URL, {
      consumerName: "reporting-store-publications-v1",
      handlers: { "StorePublished.v1": projectStorePublication },
      now: () => now,
      leaseDurationMs: 1_000,
    });
    workers.push(firstWorker);
    const claimed = await firstWorker.claimNext();
    expect(claimed?.event.eventId).toBe(event.eventId);
    expect(await firstWorker.consumeClaim(claimed!)).toBe(true);
    await firstWorker.close();

    now = new Date(now.getTime() + 1_001);
    const restartedWorker = new DurableOutboxWorker(apiTestEnvironment.DATABASE_URL, {
      consumerName: "reporting-store-publications-v1",
      handlers: { "StorePublished.v1": projectStorePublication },
      now: () => now,
      leaseDurationMs: 1_000,
    });
    workers.push(restartedWorker);
    expect(await restartedWorker.runOnce()).toBe("processed");

    const inspect = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const projections = await inspect<
      Array<{ storeId: string; lastEventId: string; publicationVersion: number }>
    >`
      select store_id as "storeId", last_event_id as "lastEventId",
        publication_version as "publicationVersion"
      from reporting_store_publications where store_id = ${event.payload.storeId}::uuid
    `;
    const receipts = await inspect<Array<{ count: number }>>`
      select count(*)::int as count from platform_outbox_consumptions
      where consumer_name = 'reporting-store-publications-v1'
        and event_id = ${event.eventId}::uuid
    `;
    await inspect.end();
    expect(projections).toEqual([
      {
        storeId: event.payload.storeId,
        lastEventId: event.eventId,
        publicationVersion: 1,
      },
    ]);
    expect(receipts).toEqual([{ count: 1 }]);
  });

  it("marks a permanently failing delivery as observable after bounded retries", async () => {
    const event = {
      ...eventEnvelopeV1Contract.parse({
        version: 1,
        eventId: randomUUID(),
        eventType: "OutboxPermanentFailureProbe.v1",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        occurredAt: "2026-08-23T12:00:00+03:30",
        correlationId: randomUUID(),
        actor: { type: "SYSTEM" },
      }),
      payload: { secretThatMustNotBeLogged: "private-value" },
    };
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await enqueueOutboxEvent(sql, event);
    await sql.end();

    const logs: Array<Readonly<Record<string, unknown>>> = [];
    const worker = new DurableOutboxWorker(apiTestEnvironment.DATABASE_URL, {
      consumerName: "permanent-failure-integration-test",
      handlers: {
        "OutboxPermanentFailureProbe.v1": async () => {
          throw new TypeError("private-value");
        },
      },
      retryDelaysMs: [0],
      maxAttempts: 2,
      log: (record) => logs.push(record),
    });
    workers.push(worker);

    expect(await worker.runOnce()).toBe("retry");
    expect(await worker.runOnce()).toBe("failed");

    const inspect = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const rows = await inspect<
      Array<{
        status: string;
        attemptCount: number;
        lastError: string;
        failedAt: Date | null;
      }>
    >`
      select status, attempt_count as "attemptCount", last_error as "lastError",
        failed_at as "failedAt"
      from platform_outbox_events where event_id = ${event.eventId}::uuid
    `;
    await inspect.end();
    expect(rows).toEqual([
      {
        status: "FAILED",
        attemptCount: 2,
        lastError: "TypeError",
        failedAt: expect.any(Date),
      },
    ]);
    expect(logs.at(-1)).toMatchObject({
      message: "outbox_delivery_failed_permanently",
      eventId: event.eventId,
      attemptCount: 2,
      errorKind: "TypeError",
    });
    expect(JSON.stringify(logs)).not.toContain("private-value");
  });

  it("owns consumer backlog inspection behind the outbox interface", async () => {
    const event = probeEvent("OutboxBacklogProbe.v1", "2026-08-23T12:00:00+03:30");
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await enqueueOutboxEvent(sql, event);
    await sql`
      update platform_outbox_events
      set status = 'FAILED', failed_at = now()
      where event_id = ${event.eventId}::uuid
    `;

    const backlog = await readOutboxConsumerBacklog(sql, {
      consumerName: "backlog-integration-test",
      eventTypes: [event.eventType],
    });
    await sql.end();

    expect(backlog).toMatchObject({ pendingEvents: 1, poisonEvents: 1 });
    expect(backlog.lagMs).toBeGreaterThan(0);
  });

  it("replays archived events in deterministic history order", async () => {
    const later = probeEvent("OutboxHistoryProbe.v1", "2026-08-23T12:00:02+03:30");
    const earlier = probeEvent("OutboxHistoryProbe.v1", "2026-08-23T12:00:01+03:30");
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await enqueueOutboxEvent(sql, later);
    await enqueueOutboxEvent(sql, earlier);
    const replayed: string[] = [];

    const replayedEventCount = await sql.begin((transaction) =>
      replayOutboxEventHistory(transaction, {
        eventTypes: ["OutboxHistoryProbe.v1"],
        handler: async (event) => {
          replayed.push(event.eventId);
        },
      }),
    );
    await sql.end();

    expect(replayed).toEqual([earlier.eventId, later.eventId]);
    expect(replayedEventCount).toBe(2);
  });

  it("catches up an unconsumed archived event through the owner interface", async () => {
    const event = probeEvent("OutboxCatchUpProbe.v1", new Date().toISOString());
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await enqueueOutboxEvent(sql, event);
    await sql`
      update platform_outbox_events set status = 'PROCESSED', processed_at = now()
      where event_id = ${event.eventId}::uuid
    `;
    await sql.end();
    const replayed: string[] = [];

    const result = await catchUpOutboxConsumer(apiTestEnvironment.DATABASE_URL, {
      consumerName: "catchup-integration-test",
      handlers: {
        "OutboxCatchUpProbe.v1": async (stored) => {
          replayed.push(stored.eventId);
        },
      },
    });

    expect(result).toEqual({ replayedEventCount: 1, poisonEventCount: 0 });
    expect(replayed).toEqual([event.eventId]);
  });
});

function probeEvent(eventType: string, occurredAt: string) {
  return {
    ...eventEnvelopeV1Contract.parse({
      version: 1,
      eventId: randomUUID(),
      eventType,
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      occurredAt,
      correlationId: randomUUID(),
      actor: { type: "SYSTEM" },
    }),
    payload: { probe: true },
  };
}

async function signIn(server: {
  inject(options: Record<string, unknown>): Promise<{
    headers: Record<string, string | string[] | undefined>;
    json<T>(): T;
  }>;
}) {
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

function storeWriteHeaders(cookie: string | string[], expectedRevision: number) {
  return {
    cookie,
    "idempotency-key": randomUUID(),
    "if-match": `"${expectedRevision}"`,
  };
}
