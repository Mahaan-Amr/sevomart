import { randomUUID } from "node:crypto";

import {
  eventActorV1Contract,
  type EventActorV1,
  type EventEnvelopeV1,
} from "@sevo/contracts/platform/v1";
import { getMeter } from "@sevo/observability";
import postgres from "postgres";
import type { JSONValue, Sql } from "postgres";

type DurableEventEnvelopeV1 = Omit<EventEnvelopeV1, "actor"> & {
  actor: EventActorV1;
};

export type OutboxEventV1<TPayload extends JSONValue> = DurableEventEnvelopeV1 & {
  payload: TPayload;
};

export async function enqueueOutboxEvent<TPayload extends JSONValue>(
  sql: Sql,
  event: OutboxEventV1<TPayload>,
): Promise<void> {
  await sql`
    insert into platform_outbox_events
      (event_id, envelope_version, event_type, aggregate_id, aggregate_version, occurred_at,
       correlation_id, causation_id, actor_type, actor_id, payload, available_at)
    values
      (${event.eventId}, ${event.version}, ${event.eventType}, ${event.aggregateId},
       ${event.aggregateVersion}, ${event.occurredAt}, ${event.correlationId},
       ${event.causationId ?? null}, ${event.actor.type},
       ${event.actor.type === "IDENTITY" ? event.actor.id : null},
       ${sql.json(event.payload)}, ${event.occurredAt})
  `;
}

export type StoredOutboxEvent = DurableEventEnvelopeV1 & { payload: JSONValue };
export type OutboxEventHandler = (event: StoredOutboxEvent, sql: Sql) => Promise<void>;
export type OutboxRunResult = "idle" | "processed" | "retry" | "failed";

export type ClaimedOutboxEvent = {
  event: StoredOutboxEvent;
  attemptCount: number;
  leaseOwner: string;
};

type DurableOutboxWorkerOptions = {
  consumerName: string;
  handlers: Readonly<Record<string, OutboxEventHandler>>;
  now?: () => Date;
  workerId?: string;
  leaseDurationMs?: number;
  retryDelaysMs?: readonly number[];
  maxAttempts?: number;
  pollIntervalMs?: number;
  healthIntervalMs?: number;
  log?: (record: Readonly<Record<string, unknown>>) => void;
};

const outboxMeter = getMeter("sevo.outbox.operations");
const outboxDeliveryFailureMetric = outboxMeter.createCounter(
  "sevo.outbox.delivery.failures",
);
const outboxPendingMetric = outboxMeter.createGauge(
  "sevo.outbox.consumer.pending_events",
);
const outboxPoisonMetric = outboxMeter.createGauge(
  "sevo.outbox.consumer.poison_events",
);
const outboxLagMetric = outboxMeter.createGauge("sevo.outbox.consumer.lag", {
  unit: "ms",
});

type OutboxDatabaseRow = {
  eventId: string;
  version: 1;
  eventType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: Date;
  correlationId: string;
  causationId: string | null;
  actorType: "IDENTITY" | "SYSTEM";
  actorId: string | null;
  payload: JSONValue;
  attemptCount: number;
};

export type OutboxConsumerBacklog = {
  pendingEvents: number;
  poisonEvents: number;
  lagMs: number;
};

type OutboxConsumerScope = {
  consumerName: string;
  eventTypes: readonly string[];
};

export async function readOutboxConsumerBacklog(
  sql: Sql,
  scope: OutboxConsumerScope,
): Promise<OutboxConsumerBacklog> {
  const rows = await sql<OutboxConsumerBacklog[]>`
    select
      count(*)::int as "pendingEvents",
      count(*) filter (
        where consumption.status = 'FAILED'
          or (consumption.event_id is null and event.status = 'FAILED')
      )::int as "poisonEvents",
      least(2147483647, greatest(0, coalesce(floor(extract(epoch from
        (clock_timestamp() - min(event.occurred_at))) * 1000), 0)))::int as "lagMs"
    from platform_outbox_events event
    left join platform_outbox_consumptions consumption
      on consumption.event_id = event.event_id
     and consumption.consumer_name = ${scope.consumerName}
    where event.event_type in ${sql(scope.eventTypes)}
      and consumption.status is distinct from 'PROCESSED'
  `;
  return rows[0] ?? { pendingEvents: 0, poisonEvents: 0, lagMs: 0 };
}

export async function replayOutboxEventHistory(
  sql: Sql,
  options: {
    eventTypes: readonly string[];
    handler: OutboxEventHandler;
    consumerName?: string;
  },
): Promise<number> {
  const archived = await sql<OutboxDatabaseRow[]>`
    select event_id as "eventId", envelope_version as version,
      event_type as "eventType", aggregate_id as "aggregateId",
      aggregate_version as "aggregateVersion", occurred_at as "occurredAt",
      correlation_id as "correlationId", causation_id as "causationId",
      actor_type as "actorType", actor_id as "actorId", payload,
      attempt_count as "attemptCount"
    from platform_outbox_events
    where event_type in ${sql(options.eventTypes)}
    order by occurred_at, aggregate_version, event_id
  `;
  for (const row of archived) {
    await options.handler(storedOutboxEvent(row), sql);
    if (options.consumerName) {
      // Failed deliveries cannot be claimed by live workers. Rebuild can safely
      // repair those receipts without waiting on a live handler's leased row.
      await sql`
        update platform_outbox_consumptions
        set status = 'PROCESSED', consumed_at = now(),
          last_error = null, failed_at = null
        where consumer_name = ${options.consumerName}
          and event_id = ${row.eventId} and status = 'FAILED'
      `;
      await sql`
        insert into platform_outbox_consumptions
          (consumer_name, event_id, consumed_at)
        select ${options.consumerName}, ${row.eventId}, now()
        where not exists (
          select 1 from platform_outbox_consumptions
          where consumer_name = ${options.consumerName}
            and event_id = ${row.eventId}
        )
        on conflict (consumer_name, event_id) do nothing
      `;
    }
  }
  return archived.length;
}

export async function catchUpOutboxConsumer(
  databaseUrl: string,
  options: {
    consumerName: string;
    handlers: Readonly<Record<string, OutboxEventHandler>>;
    limit?: number;
    log?: (record: Readonly<Record<string, unknown>>) => void;
  },
): Promise<{ replayedEventCount: number; poisonEventCount: number }> {
  if (Object.keys(options.handlers).length === 0) {
    throw new Error("Outbox catch-up requires at least one event handler");
  }
  const worker = new DurableOutboxWorker(databaseUrl, {
    consumerName: options.consumerName,
    handlers: options.handlers,
    healthIntervalMs: Number.POSITIVE_INFINITY,
    log: options.log,
  });
  let replayedEventCount = 0;
  try {
    for (let index = 0; index < (options.limit ?? 1_000); index += 1) {
      const result = await worker.runOnce();
      if (result === "idle") break;
      if (result === "processed") {
        replayedEventCount += 1;
      } else if (result === "failed") {
        break;
      }
    }
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const backlog = await readOutboxConsumerBacklog(sql, {
        consumerName: options.consumerName,
        eventTypes: Object.keys(options.handlers),
      });
      return { replayedEventCount, poisonEventCount: backlog.poisonEvents };
    } finally {
      await sql.end();
    }
  } finally {
    await worker.close();
  }
}

function storedOutboxEvent(row: OutboxDatabaseRow): StoredOutboxEvent {
  return {
    version: row.version,
    eventId: row.eventId,
    eventType: row.eventType,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion,
    occurredAt: row.occurredAt.toISOString(),
    correlationId: row.correlationId,
    ...(row.causationId ? { causationId: row.causationId } : {}),
    actor: eventActorV1Contract.parse(
      row.actorType === "IDENTITY"
        ? { type: "IDENTITY", id: row.actorId }
        : { type: "SYSTEM" },
    ),
    payload: row.payload,
  };
}

export class DurableOutboxWorker {
  readonly #sql: Sql;
  readonly #consumerName: string;
  readonly #handlers: Readonly<Record<string, OutboxEventHandler>>;
  readonly #eventTypes: readonly string[];
  readonly #now: () => Date;
  readonly #workerId: string;
  readonly #leaseDurationMs: number;
  readonly #retryDelaysMs: readonly number[];
  readonly #maxAttempts: number;
  readonly #pollIntervalMs: number;
  readonly #healthIntervalMs: number;
  readonly #log: (record: Readonly<Record<string, unknown>>) => void;
  #loop?: Promise<void>;
  #stopping = false;
  #closed = false;
  #wake?: () => void;
  #nextHealthCheckAt = 0;

  constructor(databaseUrl: string, options: DurableOutboxWorkerOptions) {
    if (Object.keys(options.handlers).length === 0) {
      throw new Error("A durable outbox worker requires at least one event handler");
    }
    if ((options.maxAttempts ?? 5) < 1) {
      throw new Error("A durable outbox worker requires at least one attempt");
    }
    if (options.retryDelaysMs?.length === 0) {
      throw new Error("A durable outbox worker requires at least one retry delay");
    }
    this.#sql = postgres(databaseUrl, { max: 2 });
    this.#consumerName = options.consumerName;
    this.#handlers = options.handlers;
    this.#eventTypes = Object.keys(options.handlers);
    this.#now = options.now ?? (() => new Date());
    this.#workerId = options.workerId ?? randomUUID();
    this.#leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.#retryDelaysMs = options.retryDelaysMs ?? [1_000, 5_000, 30_000, 120_000];
    this.#maxAttempts = options.maxAttempts ?? 5;
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
    this.#healthIntervalMs = options.healthIntervalMs ?? 15_000;
    this.#log =
      options.log ??
      ((record) => {
        console.log(JSON.stringify(record));
      });
  }

  async start(): Promise<void> {
    if (this.#closed) throw new Error("The durable outbox worker is closed");
    if (this.#loop) return;
    this.#stopping = false;
    await this.runOnce();
    this.#loop = this.#runLoop();
  }

  async runOnce(): Promise<OutboxRunResult> {
    await this.#recordOperationalHealth();
    const claimed = await this.claimNext();
    if (!claimed) return "idle";
    const result = await this.processClaim(claimed);
    if (result === "failed") await this.#recordOperationalHealth(true);
    return result;
  }

  async claimNext(): Promise<ClaimedOutboxEvent | undefined> {
    const now = this.#now();
    const leaseExpiresAt = new Date(now.getTime() + this.#leaseDurationMs);
    const rows = await this.#sql.begin(async (sql) => {
      await sql`
        insert into platform_outbox_consumptions
          (consumer_name, event_id, status, available_at, consumed_at)
        select ${this.#consumerName}, event.event_id, 'READY', event.available_at, null
        from platform_outbox_events event
        where event.event_type in ${sql(this.#eventTypes)}
          and not exists (
            select 1 from platform_outbox_consumptions delivery
            where delivery.consumer_name = ${this.#consumerName}
              and delivery.event_id = event.event_id
          )
        order by event.created_at, event.event_id
        limit 1
        on conflict (consumer_name, event_id) do nothing
      `;
      return sql<OutboxDatabaseRow[]>`
        with candidate as (
          select delivery.consumer_name, delivery.event_id
          from platform_outbox_consumptions delivery
          join platform_outbox_events event on event.event_id = delivery.event_id
          where delivery.consumer_name = ${this.#consumerName}
            and event.event_type in ${sql(this.#eventTypes)}
            and (
              (delivery.status = 'READY' and delivery.available_at <= ${now})
              or (delivery.status = 'LEASED' and delivery.lease_expires_at <= ${now})
            )
          order by delivery.available_at, event.created_at, event.event_id
          for update of delivery skip locked
          limit 1
        ), leased as (
          update platform_outbox_consumptions delivery
          set status = 'LEASED', lease_owner = ${this.#workerId},
            lease_expires_at = ${leaseExpiresAt},
            attempt_count = delivery.attempt_count + 1,
            last_error = null, failed_at = null
          from candidate
          where delivery.consumer_name = candidate.consumer_name
            and delivery.event_id = candidate.event_id
          returning delivery.event_id, delivery.attempt_count
        )
        select event.event_id as "eventId", event.envelope_version as version,
          event.event_type as "eventType", event.aggregate_id as "aggregateId",
          event.aggregate_version as "aggregateVersion",
          event.occurred_at as "occurredAt", event.correlation_id as "correlationId",
          event.causation_id as "causationId", event.actor_type as "actorType",
          event.actor_id as "actorId", event.payload,
          leased.attempt_count as "attemptCount"
        from leased
        join platform_outbox_events event on event.event_id = leased.event_id
      `;
    });
    const row = rows[0];
    if (!row) return undefined;
    return {
      event: storedOutboxEvent(row),
      attemptCount: row.attemptCount,
      leaseOwner: this.#workerId,
    };
  }

  async consumeClaim(claimed: ClaimedOutboxEvent): Promise<boolean> {
    const handler = this.#handlers[claimed.event.eventType];
    if (!handler) throw new Error("Outbox handler is not registered");
    return this.#sql.begin(async (sql) => {
      const deliveries = await sql<Array<{ eventId: string }>>`
        select event_id as "eventId"
        from platform_outbox_consumptions
        where consumer_name = ${this.#consumerName}
          and event_id = ${claimed.event.eventId}
          and status = 'LEASED' and lease_owner = ${claimed.leaseOwner}
          and attempt_count = ${claimed.attemptCount}
        for update
      `;
      if (!deliveries[0]) return false;
      await handler(claimed.event, sql);
      await sql`
        update platform_outbox_consumptions
        set status = 'PROCESSED', consumed_at = ${this.#now()},
          lease_owner = null, lease_expires_at = null,
          last_error = null, failed_at = null
        where consumer_name = ${this.#consumerName}
          and event_id = ${claimed.event.eventId}
          and status = 'LEASED' and lease_owner = ${claimed.leaseOwner}
          and attempt_count = ${claimed.attemptCount}
      `;
      return true;
    });
  }

  async acknowledgeClaim(claimed: ClaimedOutboxEvent): Promise<void> {
    await this.#sql`
      update platform_outbox_events
      set status = 'PROCESSED', processed_at = ${this.#now()},
        lease_owner = null, lease_expires_at = null, last_error = null,
        attempt_count = greatest(attempt_count, ${claimed.attemptCount})
      where event_id = ${claimed.event.eventId}
        and status <> 'FAILED'
    `;
  }

  async processClaim(claimed: ClaimedOutboxEvent): Promise<OutboxRunResult> {
    try {
      const consumed = await this.consumeClaim(claimed);
      if (!consumed) return "idle";
      await this.acknowledgeClaim(claimed);
      return "processed";
    } catch (error) {
      const permanent = claimed.attemptCount >= this.#maxAttempts;
      const delayIndex = Math.min(
        claimed.attemptCount - 1,
        this.#retryDelaysMs.length - 1,
      );
      const delay = this.#retryDelaysMs[delayIndex] ?? 0;
      const availableAt = new Date(this.#now().getTime() + delay);
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      await this.#sql`
        update platform_outbox_consumptions
        set status = ${permanent ? "FAILED" : "READY"},
          available_at = ${availableAt}, lease_owner = null, lease_expires_at = null,
          last_error = ${errorKind}, failed_at = ${permanent ? this.#now() : null}
        where consumer_name = ${this.#consumerName}
          and event_id = ${claimed.event.eventId}
          and status = 'LEASED' and lease_owner = ${claimed.leaseOwner}
          and attempt_count = ${claimed.attemptCount}
      `;
      await this.#sql`
        update platform_outbox_events
        set status = case when ${permanent} then 'FAILED' else status end,
          attempt_count = greatest(attempt_count, ${claimed.attemptCount}),
          last_error = ${errorKind},
          failed_at = case when ${permanent} then ${this.#now()} else failed_at end
        where event_id = ${claimed.event.eventId}
      `;
      this.#log({
        level: permanent ? "error" : "warn",
        message: permanent
          ? "outbox_delivery_failed_permanently"
          : "outbox_delivery_retry",
        eventId: claimed.event.eventId,
        eventType: claimed.event.eventType,
        correlationId: claimed.event.correlationId,
        attemptCount: claimed.attemptCount,
        errorKind,
      });
      outboxDeliveryFailureMetric.add(1, {
        consumer_name: this.#consumerName,
        event_type: claimed.event.eventType,
        permanent,
      });
      return permanent ? "failed" : "retry";
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#stopping = true;
    this.#wake?.();
    try {
      await this.#loop;
    } finally {
      await this.#sql.end();
      this.#closed = true;
    }
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopping) {
      let result: OutboxRunResult = "idle";
      try {
        result = await this.runOnce();
      } catch (error) {
        this.#log({
          level: "error",
          message: "outbox_worker_cycle_failed",
          consumerName: this.#consumerName,
          errorKind: error instanceof Error ? error.name : "UnknownError",
        });
      }
      if (result === "idle" && !this.#stopping) await this.#waitForPoll();
    }
  }

  async #recordOperationalHealth(force = false): Promise<void> {
    const now = this.#now().getTime();
    if (!force && now < this.#nextHealthCheckAt) return;
    const backlog = await readOutboxConsumerBacklog(this.#sql, {
      consumerName: this.#consumerName,
      eventTypes: this.#eventTypes,
    });
    const attributes = { consumer_name: this.#consumerName };
    outboxPendingMetric.record(backlog.pendingEvents, attributes);
    outboxPoisonMetric.record(backlog.poisonEvents, attributes);
    outboxLagMetric.record(backlog.lagMs, attributes);
    this.#nextHealthCheckAt = now + this.#healthIntervalMs;
  }

  async #waitForPoll(): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.#pollIntervalMs);
      this.#wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.#wake = undefined;
  }
}
