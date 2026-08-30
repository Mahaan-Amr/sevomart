import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDemoSeedRequest, executeDemoSeed } from "../../scripts/demo/runtime.mjs";
import { createPostgresDemoSeedDatabase } from "../../scripts/demo/postgres.mjs";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
const sql = postgres(databaseUrl, { max: 2 });
let fingerprint = "";

function request(...extraArguments: string[]) {
  return createDemoSeedRequest(
    [
      "--profile",
      "demo",
      "--target",
      "local",
      "--database-url",
      databaseUrl,
      "--fingerprint",
      fingerprint,
      ...extraArguments,
    ],
    {
      SEVO_RUNTIME_ENV: "development",
      MINIO_ENDPOINT: "127.0.0.1",
      OTP_PROVIDER: "dev",
    },
  );
}

describe("demo seed PostgreSQL runtime", () => {
  beforeAll(async () => {
    const targets = await sql<Array<{ fingerprint: string }>>`
      select fingerprint::text as fingerprint
      from platform_data_environment
      where singleton = true
    `;
    fingerprint = targets[0]?.fingerprint ?? "";
    await sql`delete from platform_seed_manifest_receipts where namespace = 'sevo.demo'`;
  });

  afterAll(async () => {
    await sql`delete from platform_seed_manifest_receipts where namespace = 'sevo.demo'`;
    await sql.end();
  });

  it("matches the registered target and records only an applied manifest", async () => {
    const database = createPostgresDemoSeedDatabase(databaseUrl);
    try {
      await executeDemoSeed(request("--dry-run"), database);
      expect(await receiptCount()).toBe(0);

      const report = await executeDemoSeed(request(), database);
      expect(report.manifestVersion).toBe(1);
      expect(await receiptCount()).toBe(1);
    } finally {
      await database.close();
    }
  });

  it("refuses a concurrent run for the same namespace", async () => {
    const lock = postgres(databaseUrl, { max: 1 });
    const database = createPostgresDemoSeedDatabase(databaseUrl);
    try {
      await lock`select pg_advisory_lock(hashtextextended('sevo.demo', 0))`;
      await expect(executeDemoSeed(request("--dry-run"), database)).rejects.toThrow(
        "already running",
      );
    } finally {
      await lock`select pg_advisory_unlock(hashtextextended('sevo.demo', 0))`;
      await lock.end();
      await database.close();
    }
  });
});

async function receiptCount() {
  const rows = await sql<Array<{ count: number }>>`
    select count(*)::int as count
    from platform_seed_manifest_receipts
    where namespace = 'sevo.demo'
  `;
  return rows[0]?.count ?? 0;
}
