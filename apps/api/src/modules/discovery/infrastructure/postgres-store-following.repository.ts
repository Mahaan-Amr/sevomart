import { createHash, randomUUID } from "node:crypto";

import {
  publicFollowerCountV1Contract,
  storeFollowActivatedV1Contract,
  storeFollowDeactivatedV1Contract,
  storeFollowViewV1Contract,
  type StoreFollowStatusV1,
} from "@sevo/contracts/discovery/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type JSONValue, type Sql } from "postgres";

import {
  FollowIdempotencyConflictError,
  FollowPreconditionRequiredError,
  FollowRevisionConflictError,
  type StoreFollowRepository,
  type StoreFollowWrite,
  type StoredFollowWriteResult,
} from "../public";

type FollowRow = {
  relationId: string;
  status: StoreFollowStatusV1;
  revision: number;
  activatedAt: Date;
  deactivatedAt: Date | null;
};

type IdempotencyRow = {
  requestHash: string;
  responseJson: JSONValue;
  responseEtag: string;
};

export class PostgresStoreFollowingRepository implements StoreFollowRepository {
  readonly #sql: Sql;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(
    databaseUrl: string,
    now: () => Date = () => new Date(),
    createId: () => string = randomUUID,
  ) {
    this.#sql = postgres(databaseUrl, { max: 5 });
    this.#now = now;
    this.#createId = createId;
  }

  async write(command: StoreFollowWrite): Promise<StoredFollowWriteResult> {
    return this.#sql.begin(async (sql) => {
      await sql`
        select pg_advisory_xact_lock_shared(
          hashtextextended('discovery-follower-count:rebuild', 0)
        )
      `;
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`${command.identityId}:${command.storeId}`}, 0)
        )
      `;
      const requestHash = hashCommand(command);
      const replay = await this.#readIdempotency(sql, command);
      if (replay) {
        if (replay.requestHash !== requestHash) {
          throw new FollowIdempotencyConflictError();
        }
        return {
          view: storeFollowViewV1Contract.parse(replay.responseJson),
          etag: replay.responseEtag,
        };
      }

      const rows = await sql<FollowRow[]>`
        select relation_id as "relationId", status, revision,
          activated_at as "activatedAt", deactivated_at as "deactivatedAt"
        from discovery_store_follows
        where identity_id = ${command.identityId}
          and store_id = ${command.storeId}
        for update
      `;
      const current = rows[0];
      if (current && command.expectedRevision === undefined) {
        throw new FollowPreconditionRequiredError();
      }
      if (
        command.expectedRevision !== undefined &&
        command.expectedRevision !== (current?.revision ?? 0)
      ) {
        throw new FollowRevisionConflictError(current?.revision ?? 0);
      }

      const desiredStatus = command.operation === "ACTIVATE" ? "ACTIVE" : "INACTIVE";
      if (!current && desiredStatus === "INACTIVE") {
        throw new FollowPreconditionRequiredError();
      }

      const changed = current?.status !== desiredStatus;
      const occurredAt = this.#now();
      const relationId = current?.relationId ?? this.#createId();
      const relationRevision = changed
        ? (current?.revision ?? 0) + 1
        : current.revision;
      let followSetRevision = await this.#readFollowSetRevision(
        sql,
        command.identityId,
      );

      if (changed) {
        await sql`
          insert into discovery_identity_status_projections
            (identity_id, status, status_version, updated_at)
          values (${command.identityId}, 'ACTIVE', 0, ${occurredAt})
          on conflict (identity_id) do nothing
        `;
        followSetRevision = await this.#advanceFollowSet(
          sql,
          command.identityId,
          occurredAt,
        );
        await sql`
          insert into discovery_store_follows
            (relation_id, identity_id, store_id, status, revision,
             activated_at, deactivated_at, updated_at)
          values
            (${relationId}, ${command.identityId}, ${command.storeId},
             ${desiredStatus}, ${relationRevision},
             ${desiredStatus === "ACTIVE" ? occurredAt : current!.activatedAt},
             ${desiredStatus === "INACTIVE" ? occurredAt : (current?.deactivatedAt ?? null)},
             ${occurredAt})
          on conflict (identity_id, store_id) do update set
            status = excluded.status,
            revision = excluded.revision,
            activated_at = excluded.activated_at,
            deactivated_at = excluded.deactivated_at,
            updated_at = excluded.updated_at
        `;
        await enqueueOutboxEvent(
          sql,
          (desiredStatus === "ACTIVE"
            ? storeFollowActivatedV1Contract
            : storeFollowDeactivatedV1Contract
          ).parse({
            version: 1,
            eventId: this.#createId(),
            eventType:
              desiredStatus === "ACTIVE"
                ? "StoreFollowActivated.v1"
                : "StoreFollowDeactivated.v1",
            aggregateId: relationId,
            aggregateVersion: relationRevision,
            occurredAt: occurredAt.toISOString(),
            correlationId: command.correlationId,
            causationId: command.correlationId,
            actor: { type: "SYSTEM" },
            payload: {
              storeId: command.storeId,
              relationRevision,
              followSetRevision,
            },
          }),
        );
        await sql`
          insert into discovery_follow_audits
            (id, actor_identity_id, store_id, previous_status, next_status,
             previous_revision, next_revision, correlation_id, occurred_at)
          values
            (${this.#createId()}, ${command.identityId}, ${command.storeId},
             ${current?.status ?? null}, ${desiredStatus},
             ${current?.revision ?? null}, ${relationRevision},
             ${command.correlationId}, ${occurredAt})
        `;
      }

      const view = storeFollowViewV1Contract.parse({
        version: 1,
        storeId: command.storeId,
        status: desiredStatus,
        revision: relationRevision,
        followSetRevision,
        activatedAt:
          desiredStatus === "ACTIVE"
            ? (changed ? occurredAt : current!.activatedAt).toISOString()
            : current!.activatedAt.toISOString(),
        ...(desiredStatus === "INACTIVE"
          ? {
              deactivatedAt: (changed
                ? occurredAt
                : current!.deactivatedAt!
              ).toISOString(),
            }
          : current?.deactivatedAt
            ? { deactivatedAt: current.deactivatedAt.toISOString() }
            : {}),
      });
      const result = { view, etag: `"${relationRevision}"` };
      await sql`
        insert into discovery_follow_idempotency_records
          (operation, identity_id, store_id, idempotency_key, request_hash,
           response_json, response_etag)
        values
          (${command.operation}, ${command.identityId}, ${command.storeId},
           ${command.idempotencyKey}, ${requestHash},
           ${sql.json(view as unknown as JSONValue)}, ${result.etag})
      `;
      return result;
    });
  }

  async readPublicStoreFollowing(
    storeId: StoreFollowWrite["storeId"],
    viewerIdentityId?: StoreFollowWrite["identityId"],
    fallbackUpdatedAt = new Date(0).toISOString(),
  ) {
    const counts = await this.#sql<Array<{ count: number; updatedAt: Date }>>`
      select follower_count as count, updated_at as "updatedAt"
      from discovery_public_follower_counts
      where store_id = ${storeId}
    `;
    const followerCount = publicFollowerCountV1Contract.parse({
      version: 1,
      storeId,
      count: counts[0]?.count ?? 0,
      updatedAt: counts[0]?.updatedAt.toISOString() ?? fallbackUpdatedAt,
    });
    if (!viewerIdentityId) return { followerCount };

    const follows = await this.#sql<
      Array<{ status: StoreFollowStatusV1; revision: number }>
    >`
      select status, revision from discovery_store_follows
      where identity_id = ${viewerIdentityId} and store_id = ${storeId}
    `;
    const follow = follows[0];
    const viewer = follow
      ? { isFollowing: follow.status === "ACTIVE", revision: follow.revision }
      : { isFollowing: false as const };
    return {
      followerCount,
      viewer,
      etag: `"${follow?.revision ?? 0}"`,
    };
  }

  async #readIdempotency(sql: Sql, command: StoreFollowWrite) {
    const rows = await sql<IdempotencyRow[]>`
      select request_hash as "requestHash", response_json as "responseJson",
        response_etag as "responseEtag"
      from discovery_follow_idempotency_records
      where operation = ${command.operation}
        and identity_id = ${command.identityId}
        and store_id = ${command.storeId}
        and idempotency_key = ${command.idempotencyKey}
    `;
    return rows[0];
  }

  async #readFollowSetRevision(sql: Sql, identityId: StoreFollowWrite["identityId"]) {
    const rows = await sql<Array<{ revision: number }>>`
      select revision from discovery_follow_sets where identity_id = ${identityId}
    `;
    return rows[0]?.revision ?? 0;
  }

  async #advanceFollowSet(
    sql: Sql,
    identityId: StoreFollowWrite["identityId"],
    occurredAt: Date,
  ) {
    const rows = await sql<Array<{ revision: number }>>`
      insert into discovery_follow_sets (identity_id, revision, updated_at)
      values (${identityId}, 1, ${occurredAt})
      on conflict (identity_id) do update set
        revision = discovery_follow_sets.revision + 1,
        updated_at = excluded.updated_at
      returning revision
    `;
    return rows[0]!.revision;
  }
}

function hashCommand(command: StoreFollowWrite) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        operation: command.operation,
        expectedRevision: command.expectedRevision ?? null,
      }),
    )
    .digest("hex");
}
