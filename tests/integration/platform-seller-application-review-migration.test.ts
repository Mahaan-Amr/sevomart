import { readFile } from "node:fs/promises";

import postgres from "postgres";
import { expect, test } from "vitest";

import { apiTestEnvironment } from "../helpers/api-test-environment";

test("platform review migration backfills decisions and makes audit append-only", async () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const schema = `platform_review_${crypto.randomUUID().replaceAll("-", "")}`;
  const identityId = crypto.randomUUID();
  const decisionId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  try {
    await sql.unsafe(`create schema "${schema}"`);
    await sql.unsafe(`set search_path to "${schema}"`);
    await sql.unsafe(`
      create table identity_identities (id uuid primary key);
      create table identity_seller_application_decisions (
        id uuid primary key,
        revision integer not null
      );
      create table identity_seller_application_audit (
        id uuid primary key,
        result varchar(24) not null
      );
    `);
    await sql`insert into identity_identities (id) values (${identityId})`;
    await sql`
      insert into identity_seller_application_decisions (id, revision)
      values (${decisionId}, 3)
    `;
    await sql`
      insert into identity_seller_application_audit (id, result)
      values (${auditId}, 'SUCCEEDED')
    `;

    await sql.unsafe(
      await migration(
        "20260824110000__identity-access__platform-seller-application-review",
      ),
    );
    await sql.unsafe(
      await migration("20260824110500__identity-access__audit-platform-permission"),
    );

    const decisions = await sql<Array<{ aggregateVersion: number }>>`
      select aggregate_version as "aggregateVersion"
      from identity_seller_application_decisions where id = ${decisionId}
    `;
    expect(decisions).toEqual([{ aggregateVersion: 3 }]);

    await sql`
      insert into identity_platform_permission_grants
        (id, identity_id, permission, granted_at)
      values
        (${crypto.randomUUID()}, ${identityId}, 'SELLER_APPLICATION_REVIEW', now())
    `;
    await expect(
      sql`
        insert into identity_platform_permission_grants
          (id, identity_id, permission, granted_at)
        values
          (${crypto.randomUUID()}, ${identityId}, 'SELLER_APPLICATION_REVIEW', now())
      `,
    ).rejects.toThrow();
    await expect(
      sql`update identity_seller_application_audit set result = 'DENIED'
          where id = ${auditId}`,
    ).rejects.toThrow("append-only");
    await expect(
      sql`delete from identity_seller_application_audit where id = ${auditId}`,
    ).rejects.toThrow("append-only");
  } finally {
    await sql.unsafe("set search_path to public");
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    await sql.end();
  }
});

async function migration(directory: string) {
  return readFile(
    new URL(
      `../../packages/database/prisma/migrations/${directory}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  );
}
