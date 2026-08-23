import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import postgres from "postgres";
import { expect, test } from "vitest";

import { apiTestEnvironment } from "../helpers/api-test-environment";

test("canonical identity migration preserves legacy identity and login data", async () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const schema = `identity_migration_${randomUUID().replaceAll("-", "")}`;
  const identityId = randomUUID();
  const sessionId = randomUUID();
  const legacyMigration = await readFile(
    "packages/database/prisma/migrations/20260816141000__identity-access__create-otp-sessions/migration.sql",
    "utf8",
  );
  const canonicalMigration = await readFile(
    "packages/database/prisma/migrations/20260823181500__identity-access__canonical-identity-session/migration.sql",
    "utf8",
  );

  try {
    await sql.unsafe(`create schema "${schema}"`);
    await sql.unsafe(`set search_path to "${schema}"`);
    await sql.unsafe(legacyMigration);
    await sql`
      insert into identity_sellers (id, mobile)
      values (${identityId}, '09123456789')
    `;
    await sql`
      insert into identity_seller_sessions
        (id, token_hash, seller_id, expires_at)
      values
        (${sessionId}, ${"a".repeat(64)}, ${identityId}, now() + interval '1 day')
    `;

    await sql.unsafe(canonicalMigration);

    const identities = await sql<
      Array<{
        identityId: string;
        mobile: string;
        status: string;
        legacySessionRevoked: boolean;
      }>
    >`
      select i.id as "identityId", lm.mobile, i.status,
        s.revoked_at is not null as "legacySessionRevoked"
      from identity_identities i
      join identity_login_methods lm on lm.identity_id = i.id
      join identity_sessions s on s.identity_id = i.id
    `;
    expect(identities).toEqual([
      {
        identityId,
        mobile: "09123456789",
        status: "ACTIVE",
        legacySessionRevoked: true,
      },
    ]);
  } finally {
    await sql.unsafe("set search_path to public");
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    await sql.end();
  }
});
