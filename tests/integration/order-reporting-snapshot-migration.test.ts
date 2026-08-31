import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { orderReportingSnapshotV1Contract } from "@sevo/contracts/orders/v1";
import postgres from "postgres";
import { expect, test } from "vitest";

import { apiTestEnvironment } from "../helpers/api-test-environment";

test("orders migration publishes reporting snapshots for existing paid orders", async () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const schema = `order_reporting_snapshot_${randomUUID().replaceAll("-", "")}`;
  const paidOrderId = randomUUID();
  const pendingOrderId = randomUUID();
  const storeId = randomUUID();
  const outboxMigration = await readFile(
    "packages/database/prisma/migrations/20260823180000__platform__create-durable-outbox/migration.sql",
    "utf8",
  );
  const snapshotMigration = await readFile(
    "packages/database/prisma/migrations/20260831120000__orders__reporting-snapshot/migration.sql",
    "utf8",
  );

  try {
    await sql.unsafe(`create schema "${schema}"`);
    await sql.unsafe(`set search_path to "${schema}"`);
    await sql.unsafe(outboxMigration);
    await sql.unsafe(`
      create table order_orders (
        id uuid primary key,
        store_id uuid not null,
        status varchar(32) not null,
        total_amount bigint not null,
        currency char(3) not null,
        paid_at timestamptz(3),
        created_at timestamptz(3) not null
      )
    `);
    await sql`
      insert into order_orders
        (id, store_id, status, total_amount, currency, paid_at, created_at)
      values
        (${paidOrderId}, ${storeId}, 'PAID', 3000000000, 'IRR',
         '2026-08-30T07:00:00.000Z', '2026-08-29T07:00:00.000Z'),
        (${pendingOrderId}, ${storeId}, 'PENDING_PAYMENT', 1000000, 'IRR',
         null, '2026-08-29T07:00:00.000Z')
    `;

    await sql.unsafe(snapshotMigration);

    const events = await sql<
      Array<{
        version: number;
        eventId: string;
        eventType: string;
        aggregateId: string;
        aggregateVersion: number;
        occurredAt: Date;
        correlationId: string;
        causationId: string;
        payload: unknown;
      }>
    >`
      select envelope_version as version, event_id as "eventId",
        event_type as "eventType", aggregate_id as "aggregateId",
        aggregate_version as "aggregateVersion", occurred_at as "occurredAt",
        correlation_id as "correlationId", causation_id as "causationId", payload
      from platform_outbox_events
    `;
    expect(events).toHaveLength(1);
    expect(
      orderReportingSnapshotV1Contract.parse({
        ...events[0],
        occurredAt: events[0]!.occurredAt.toISOString(),
        actor: { type: "SYSTEM" },
      }),
    ).toMatchObject({
      aggregateId: paidOrderId,
      payload: {
        storeId,
        status: "PAID",
        total: { amount: 3_000_000_000, currency: "IRR" },
        paidAt: "2026-08-30T07:00:00.000Z",
      },
    });
  } finally {
    await sql.unsafe("set search_path to public");
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    await sql.end();
  }
});
