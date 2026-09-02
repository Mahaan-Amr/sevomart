import {
  storeFollowActivatedV1Contract,
  storeFollowDeactivatedV1Contract,
} from "@sevo/contracts/discovery/v1";
import { identityStatusChangedV1Contract } from "@sevo/contracts/identity-access/v1";
import {
  catchUpOutboxConsumer,
  replayOutboxEventHistory,
  type OutboxEventHandler,
  type StoredOutboxEvent,
} from "@sevo/outbox";
import { getMeter } from "@sevo/observability";
import postgres, { type Sql } from "postgres";

const storeFollowEventTypes = [
  "StoreFollowActivated.v1",
  "StoreFollowDeactivated.v1",
] as const;

const followerCountEventTypes = [
  ...storeFollowEventTypes,
  "IdentityStatusChanged.v1",
] as const;

type FollowProjectionRow = {
  identityId: string;
  storeId: string;
  status: "ACTIVE" | "INACTIVE";
  relationRevision: number;
};

type ProjectionLog = (record: Readonly<Record<string, unknown>>) => void;

const followerCountMeter = getMeter("sevo.discovery.follower-count");
const followerCountReplayMetric = followerCountMeter.createCounter(
  "sevo.discovery.projection.replayed_events",
);
const followerCountRebuildMetric = followerCountMeter.createCounter(
  "sevo.discovery.projection.rebuilds",
);
const followerCountRebuildDurationMetric = followerCountMeter.createHistogram(
  "sevo.discovery.projection.rebuild_duration",
  { unit: "ms" },
);

export const projectStoreFollowForFollowerCount: OutboxEventHandler = async (
  event,
  sql,
) => projectStoreFollow(event, sql, true);

export const projectIdentityStatusForFollowerCount: OutboxEventHandler = async (
  event,
  sql,
) => projectIdentityStatus(event, sql, true);

async function projectIdentityStatus(
  event: StoredOutboxEvent,
  sql: Sql,
  acquireRebuildLock: boolean,
) {
  const changed = identityStatusChangedV1Contract.parse(event);
  if (changed.aggregateVersion !== changed.payload.statusVersion) {
    throw new Error("Identity status event versions do not match");
  }
  if (acquireRebuildLock) await lockFollowerCountRebuild(sql, "shared");
  await lockIdentity(sql, changed.aggregateId);
  const currentRows = await sql<
    Array<{ status: "ACTIVE" | "INACTIVE"; statusVersion: number }>
  >`
    select status, status_version as "statusVersion"
    from discovery_identity_status_projections
    where identity_id = ${changed.aggregateId}
    for update
  `;
  const current = currentRows[0];
  if (current && current.statusVersion >= changed.payload.statusVersion) return;

  await sql`
    insert into discovery_identity_status_projections
      (identity_id, status, status_version, updated_at)
    values
      (${changed.aggregateId}, ${changed.payload.status},
       ${changed.payload.statusVersion}, ${changed.occurredAt})
    on conflict (identity_id) do update set
      status = excluded.status,
      status_version = excluded.status_version,
      updated_at = excluded.updated_at
  `;
  const previousContribution = current?.status === "ACTIVE";
  const nextContribution = changed.payload.status === "ACTIVE";
  if (previousContribution === nextContribution) return;

  const relations = await sql<Array<{ storeId: string }>>`
    select store_id as "storeId"
    from discovery_follower_count_relation_projections
    where identity_id = ${changed.aggregateId} and status = 'ACTIVE'
    order by store_id
  `;
  const delta = nextContribution ? 1 : -1;
  for (const { storeId } of relations) {
    await applyFollowerCountDelta(sql, storeId, delta, changed.occurredAt);
  }
}

export const discoveryFollowerCountOutboxHandlers: Readonly<
  Record<string, OutboxEventHandler>
> = {
  "StoreFollowActivated.v1": projectStoreFollowForFollowerCount,
  "StoreFollowDeactivated.v1": projectStoreFollowForFollowerCount,
  "IdentityStatusChanged.v1": projectIdentityStatusForFollowerCount,
};

export async function catchUpDiscoveryFollowerCountProjection(
  databaseUrl: string,
  log: ProjectionLog = (record) => console.log(JSON.stringify(record)),
) {
  const result = await catchUpOutboxConsumer(databaseUrl, {
    consumerName: "discovery-follower-count-v1",
    handlers: discoveryFollowerCountOutboxHandlers,
    log: (record) =>
      log({
        ...record,
        message: "discovery_projection_catchup_failed",
        projection: "follower-count",
      }),
  });
  if (result.replayedEventCount > 0 || result.poisonEventCount > 0) {
    log({
      level: result.poisonEventCount > 0 ? "error" : "info",
      message: "discovery_projection_catchup_completed",
      projection: "follower-count",
      replayedEventCount: result.replayedEventCount,
      poisonEventCount: result.poisonEventCount,
    });
  }
  followerCountReplayMetric.add(result.replayedEventCount, {
    projection: "follower-count",
    operation: "catchup",
  });
  return result;
}

export async function rebuildDiscoveryFollowerCountProjection(
  databaseUrl: string,
  log: ProjectionLog = (record) => console.log(JSON.stringify(record)),
) {
  const sql = postgres(databaseUrl, { max: 1 });
  const startedAt = Date.now();
  try {
    const result = await sql.begin(async (transaction) => {
      await lockFollowerCountRebuild(transaction, "exclusive");
      await transaction`delete from discovery_public_follower_counts`;
      await transaction`delete from discovery_follower_count_relation_projections`;
      await transaction`delete from discovery_identity_status_projections`;
      await transaction`
        insert into discovery_identity_status_projections
          (identity_id, status, status_version, updated_at)
        select identity_id, 'ACTIVE', 0, min(updated_at)
        from discovery_store_follows
        group by identity_id
      `;
      const replayedEventCount = await replayOutboxEventHistory(transaction, {
        consumerName: "discovery-follower-count-v1",
        eventTypes: followerCountEventTypes,
        handler: (event, replaySql) =>
          event.eventType === "IdentityStatusChanged.v1"
            ? projectIdentityStatus(event, replaySql, false)
            : projectStoreFollow(event, replaySql, false),
      });
      return { replayedEventCount };
    });
    const durationMs = Date.now() - startedAt;
    log({
      level: "info",
      message: "discovery_projection_rebuild_completed",
      projection: "follower-count",
      replayedEventCount: result.replayedEventCount,
      durationMs,
    });
    followerCountRebuildMetric.add(1, {
      projection: "follower-count",
      outcome: "healthy",
    });
    followerCountRebuildDurationMetric.record(durationMs, {
      projection: "follower-count",
      outcome: "healthy",
    });
    followerCountReplayMetric.add(result.replayedEventCount, {
      projection: "follower-count",
      operation: "rebuild",
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    log({
      level: "error",
      message: "discovery_projection_rebuild_failed",
      projection: "follower-count",
      durationMs,
      errorKind: error instanceof Error ? error.name : "UnknownError",
    });
    followerCountRebuildMetric.add(1, {
      projection: "follower-count",
      outcome: "failed",
    });
    followerCountRebuildDurationMetric.record(durationMs, {
      projection: "follower-count",
      outcome: "failed",
    });
    throw error;
  } finally {
    await sql.end();
  }
}

async function projectStoreFollow(
  event: StoredOutboxEvent,
  sql: Sql,
  acquireRebuildLock: boolean,
) {
  const changed =
    event.eventType === "StoreFollowActivated.v1"
      ? storeFollowActivatedV1Contract.parse(event)
      : storeFollowDeactivatedV1Contract.parse(event);
  if (changed.aggregateVersion !== changed.payload.relationRevision) {
    throw new Error("Store-follow event versions do not match");
  }
  if (acquireRebuildLock) await lockFollowerCountRebuild(sql, "shared");

  const relationRows = await sql<Array<{ identityId: string; storeId: string }>>`
    select identity_id as "identityId", store_id as "storeId"
    from discovery_store_follows
    where relation_id = ${changed.aggregateId}
  `;
  const relation = relationRows[0];
  if (!relation || relation.storeId !== changed.payload.storeId) {
    throw new Error("Store-follow relation is missing for follower-count projection");
  }
  await lockIdentity(sql, relation.identityId);

  const projectedRows = await sql<FollowProjectionRow[]>`
    select identity_id as "identityId", store_id as "storeId", status,
      relation_revision as "relationRevision"
    from discovery_follower_count_relation_projections
    where relation_id = ${changed.aggregateId}
    for update
  `;
  const projected = projectedRows[0];
  if (projected && projected.relationRevision >= changed.payload.relationRevision) {
    return;
  }
  if (
    projected &&
    (projected.identityId !== relation.identityId ||
      projected.storeId !== relation.storeId)
  ) {
    throw new Error("Store-follow relation identity changed during projection");
  }

  const identityRows = await sql<Array<{ status: "ACTIVE" | "INACTIVE" }>>`
    select status from discovery_identity_status_projections
    where identity_id = ${relation.identityId}
  `;
  const identityIsActive = identityRows[0]?.status === "ACTIVE";
  const nextStatus =
    changed.eventType === "StoreFollowActivated.v1" ? "ACTIVE" : "INACTIVE";
  const previousContribution = projected?.status === "ACTIVE" && identityIsActive;
  const nextContribution = nextStatus === "ACTIVE" && identityIsActive;

  await sql`
    insert into discovery_follower_count_relation_projections
      (relation_id, identity_id, store_id, status, relation_revision, updated_at)
    values
      (${changed.aggregateId}, ${relation.identityId}, ${relation.storeId},
       ${nextStatus}, ${changed.payload.relationRevision}, ${changed.occurredAt})
    on conflict (relation_id) do update set
      status = excluded.status,
      relation_revision = excluded.relation_revision,
      updated_at = excluded.updated_at
  `;
  if (nextContribution !== previousContribution) {
    await applyFollowerCountDelta(
      sql,
      relation.storeId,
      nextContribution ? 1 : -1,
      changed.occurredAt,
    );
  }
}

async function applyFollowerCountDelta(
  sql: Sql,
  storeId: string,
  delta: 1 | -1,
  occurredAt: string,
) {
  if (delta === 1) {
    await sql`
      insert into discovery_public_follower_counts
        (store_id, follower_count, updated_at)
      values (${storeId}, 1, ${occurredAt})
      on conflict (store_id) do update set
        follower_count = discovery_public_follower_counts.follower_count + 1,
        updated_at = excluded.updated_at
    `;
    return;
  }
  const updated = await sql<Array<{ count: number }>>`
    update discovery_public_follower_counts
    set follower_count = follower_count - 1, updated_at = ${occurredAt}
    where store_id = ${storeId} and follower_count > 0
    returning follower_count as count
  `;
  if (!updated[0]) throw new Error("Public follower count cannot become negative");
}

async function lockIdentity(sql: Sql, identityId: string) {
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`discovery-follower-count:${identityId}`}, 0)
    )
  `;
}

async function lockFollowerCountRebuild(sql: Sql, mode: "shared" | "exclusive") {
  if (mode === "shared") {
    await sql`
      select pg_advisory_xact_lock_shared(
        hashtextextended('discovery-follower-count:rebuild', 0)
      )
    `;
    return;
  }
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended('discovery-follower-count:rebuild', 0)
    )
  `;
}
