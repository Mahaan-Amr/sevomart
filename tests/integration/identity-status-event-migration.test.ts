import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import postgres from "postgres";
import { expect, test } from "vitest";

import { apiTestEnvironment } from "../helpers/api-test-environment";

test("identity status event migration backfills durable history for inactive identities", async () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const schema = `identity_status_event_${randomUUID().replaceAll("-", "")}`;
  const activeIdentityId = randomUUID();
  const inactiveIdentityId = randomUUID();
  const outboxMigration = await readFile(
    "packages/database/prisma/migrations/20260823180000__platform__create-durable-outbox/migration.sql",
    "utf8",
  );
  const statusEventMigration = await readFile(
    "packages/database/prisma/migrations/20260830120000__identity-access__publish-status-changes/migration.sql",
    "utf8",
  );

  try {
    await sql.unsafe(`create schema "${schema}"`);
    await sql.unsafe(`set search_path to "${schema}"`);
    await sql.unsafe(outboxMigration);
    await sql.unsafe(`
      create table identity_identities (
        id uuid primary key,
        status varchar(16) not null default 'ACTIVE'
      )
    `);
    await sql`
      insert into identity_identities (id, status)
      values (${activeIdentityId}, 'ACTIVE'), (${inactiveIdentityId}, 'INACTIVE')
    `;

    await sql.unsafe(statusEventMigration);

    const identities = await sql<
      Array<{ identityId: string; status: string; statusVersion: number }>
    >`
      select id as "identityId", status, status_version as "statusVersion"
      from identity_identities order by id
    `;
    expect(identities).toEqual(
      [
        { identityId: activeIdentityId, status: "ACTIVE", statusVersion: 0 },
        { identityId: inactiveIdentityId, status: "INACTIVE", statusVersion: 1 },
      ].sort((left, right) => left.identityId.localeCompare(right.identityId)),
    );
    const backfilledEvents = await sql<
      Array<{
        aggregateId: string;
        aggregateVersion: number;
        eventType: string;
        payload: { status: string; statusVersion: number };
      }>
    >`
      select aggregate_id as "aggregateId",
        aggregate_version as "aggregateVersion", event_type as "eventType", payload
      from platform_outbox_events order by aggregate_id
    `;
    expect(backfilledEvents).toEqual([
      {
        aggregateId: inactiveIdentityId,
        aggregateVersion: 1,
        eventType: "IdentityStatusChanged.v1",
        payload: { status: "INACTIVE", statusVersion: 1 },
      },
    ]);

    await sql`
      update identity_identities set status = 'ACTIVE'
      where id = ${inactiveIdentityId}
    `;
    const versions = await sql<Array<{ aggregateVersion: number }>>`
      select aggregate_version as "aggregateVersion"
      from platform_outbox_events where aggregate_id = ${inactiveIdentityId}
      order by aggregate_version
    `;
    expect(versions).toEqual([{ aggregateVersion: 1 }, { aggregateVersion: 2 }]);
  } finally {
    await sql.unsafe("set search_path to public");
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    await sql.end();
  }
});
