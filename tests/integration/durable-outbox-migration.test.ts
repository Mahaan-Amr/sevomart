import { readFile } from "node:fs/promises";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("durable outbox envelope-version migration", () => {
  it("upgrades an already-created outbox and preserves existing events", async () => {
    const schema = `outbox_migration_${crypto.randomUUID().replaceAll("-", "")}`;
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql.unsafe(`create schema "${schema}"`);
      await sql.unsafe(`set search_path to "${schema}"`);
      await sql.unsafe(`
        create table platform_outbox_events (
          event_id uuid primary key,
          event_type varchar(120) not null
        )
      `);
      const eventId = crypto.randomUUID();
      await sql`
        insert into platform_outbox_events (event_id, event_type)
        values (${eventId}, 'LegacyEvent.v1')
      `;

      await sql.unsafe(await migration());

      const events = await sql<
        Array<{ eventId: string; eventType: string; envelopeVersion: number }>
      >`
        select event_id as "eventId", event_type as "eventType",
          envelope_version as "envelopeVersion"
        from platform_outbox_events
      `;
      expect(events).toEqual([
        { eventId, eventType: "LegacyEvent.v1", envelopeVersion: 1 },
      ]);
    } finally {
      await sql.unsafe(`drop schema if exists "${schema}" cascade`);
      await sql.end();
    }
  });
});

async function migration() {
  return readFile(
    new URL(
      "../../packages/database/prisma/migrations/20260824105000__platform__backfill-outbox-envelope-version/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
}
