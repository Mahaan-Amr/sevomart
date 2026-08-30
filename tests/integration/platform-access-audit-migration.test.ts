import { readFile } from "node:fs/promises";

import postgres, { type Sql } from "postgres";
import { expect, test } from "vitest";

import { apiTestEnvironment } from "../helpers/api-test-environment";

test("unresolved audit migration preserves populated append-only history", async () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const schema = `platform_access_audit_${crypto.randomUUID().replaceAll("-", "")}`;
  const grantId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const identityId = crypto.randomUUID();

  try {
    await sql.unsafe(`create schema "${schema}"`);
    await sql.unsafe(`set search_path to "${schema}"`);
    await createLegacyAuditSchema(sql, { grantId, auditId, identityId });

    await sql.unsafe(await migration());

    expect(
      await sql<
        Array<{
          grantId: string;
          resolvedGrantId: string | null;
          attemptedResponsibility: string | null;
          triggerEnabled: boolean;
        }>
      >`
        select audit.grant_id as "grantId",
          audit.resolved_grant_id as "resolvedGrantId",
          audit.attempted_responsibility as "attemptedResponsibility",
          exists(
            select 1 from pg_trigger
            where tgname = 'identity_platform_access_audit_immutable'
              and tgenabled = 'O'
          ) as "triggerEnabled"
        from identity_platform_access_audit audit where audit.id = ${auditId}
      `,
    ).toEqual([
      {
        grantId,
        resolvedGrantId: grantId,
        attemptedResponsibility: "PAYMENT_REVIEW",
        triggerEnabled: true,
      },
    ]);
    await expect(
      sql`update identity_platform_access_audit set outcome = 'DENIED' where id = ${auditId}`,
    ).rejects.toThrow("append-only");

    await sql`
      insert into identity_platform_access_audit
        (id, grant_id, resolved_grant_id, attempted_responsibility, action,
         actor_identity_id, subject_identity_id, scope, reason_code, reason, outcome,
         single_manager_exception, correlation_id, occurred_at)
      values
        (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${null}, 'PAYMENT_REVIEW',
         'SENSITIVE_FIELD_REVEALED', ${identityId}, ${null}, ${sql.json({
           resourceType: "PAYMENT_REVIEW",
           resourceId: crypto.randomUUID(),
           allowedActions: ["REVEAL_MINIMUM"],
         })}, 'ACCESS_REQUEST_REJECTED', 'تلاش ردشده با شناسه نامعتبر', 'DENIED',
         ${null}, ${crypto.randomUUID()}, now())
    `;
  } finally {
    await sql.unsafe("set search_path to public");
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    await sql.end();
  }
});

test("unresolved audit migration rolls back its append-only guard on failure", async () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const schema = `platform_access_audit_failure_${crypto.randomUUID().replaceAll("-", "")}`;
  const grantId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const identityId = crypto.randomUUID();

  try {
    await sql.unsafe(`create schema "${schema}"`);
    await sql.unsafe(`set search_path to "${schema}"`);
    await createLegacyAuditSchema(sql, { grantId, auditId, identityId });
    const failingMigration = (await migration()).replace(
      'UPDATE "identity_platform_access_audit" audit',
      'SELECT deliberately_missing_column FROM "identity_platform_access_audit";\n\nUPDATE "identity_platform_access_audit" audit',
    );

    await expect(sql.unsafe(failingMigration)).rejects.toThrow();
    await sql.unsafe("rollback");

    expect(
      await sql<Array<{ triggerEnabled: boolean; newColumnCount: number }>>`
        select exists(
          select 1 from pg_trigger
          where tgname = 'identity_platform_access_audit_immutable'
            and tgenabled = 'O'
        ) as "triggerEnabled",
        (
          select count(*)::int from information_schema.columns
          where table_schema = ${schema}
            and table_name = 'identity_platform_access_audit'
            and column_name in ('resolved_grant_id', 'attempted_responsibility')
        ) as "newColumnCount"
      `,
    ).toEqual([{ triggerEnabled: true, newColumnCount: 0 }]);
    await expect(
      sql`update identity_platform_access_audit set outcome = 'DENIED' where id = ${auditId}`,
    ).rejects.toThrow("append-only");
  } finally {
    await sql.unsafe("rollback").catch(() => undefined);
    await sql.unsafe("set search_path to public");
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    await sql.end();
  }
});

async function createLegacyAuditSchema(
  sql: Sql,
  input: { grantId: string; auditId: string; identityId: string },
) {
  await sql.unsafe(`
    create table identity_platform_access_grants (
      id uuid primary key,
      responsibility varchar(64) not null
    );
    create table identity_platform_access_audit (
      id uuid primary key,
      grant_id uuid not null,
      action varchar(48) not null,
      actor_identity_id uuid not null,
      subject_identity_id uuid not null,
      scope jsonb,
      reason_code varchar(48) not null,
      reason varchar(1000) not null,
      outcome varchar(32) not null,
      single_manager_exception boolean not null,
      correlation_id uuid not null,
      occurred_at timestamptz(3) not null,
      constraint identity_platform_access_audit_grant_fkey
        foreign key (grant_id) references identity_platform_access_grants(id)
    );
    create index identity_platform_access_audit_grant_time_idx
      on identity_platform_access_audit (grant_id, occurred_at, id);
    create function identity_reject_platform_access_audit_change()
    returns trigger language plpgsql as $$
    begin
      raise exception 'identity_platform_access_audit is append-only';
    end;
    $$;
    create trigger identity_platform_access_audit_immutable
    before update or delete on identity_platform_access_audit
    for each row execute function identity_reject_platform_access_audit_change();
  `);
  await sql`
    insert into identity_platform_access_grants (id, responsibility)
    values (${input.grantId}, 'PAYMENT_REVIEW')
  `;
  await sql`
    insert into identity_platform_access_audit
      (id, grant_id, action, actor_identity_id, subject_identity_id, scope,
       reason_code, reason, outcome, single_manager_exception, correlation_id,
       occurred_at)
    values
      (${input.auditId}, ${input.grantId}, 'SENSITIVE_FIELD_REVEALED',
       ${input.identityId}, ${input.identityId}, ${sql.json({
         resourceType: "PAYMENT_REVIEW",
         resourceId: crypto.randomUUID(),
         allowedActions: ["REVEAL_MINIMUM"],
       })}, 'CASE_ACCESS_APPROVED', 'بررسی پرونده موجود', 'SUCCEEDED', false,
       ${crypto.randomUUID()}, now())
  `;
}

async function migration() {
  return readFile(
    new URL(
      "../../packages/database/prisma/migrations/20260830113000__identity-access__audit-unresolved-sensitive-attempts/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
}
