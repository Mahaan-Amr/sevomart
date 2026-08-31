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
    await sql`delete from platform_seed_resources where namespace = 'sevo.demo'`;
  });

  afterAll(async () => {
    await sql`delete from platform_seed_resources where namespace = 'sevo.demo'`;
    await sql`delete from platform_seed_manifest_receipts where namespace = 'sevo.demo'`;
    await sql.end();
  });

  it("matches the registered target and records only an applied manifest", async () => {
    const database = createPostgresDemoSeedDatabase(databaseUrl);
    try {
      await executeDemoSeed(request("--dry-run"), database);
      expect(await receiptCount()).toBe(0);

      const report = await executeDemoSeed(request(), database);
      expect(report.manifestVersion).toBe(2);
      expect(report.entities).toMatchObject({
        loginIdentities: 5,
        stores: 4,
        products: 11,
        salesContents: 6,
        conversations: 3,
        orders: 10,
      });
      expect(await receiptCount()).toBe(1);
      expect(await seededEntityCounts()).toEqual({
        loginIdentities: 5,
        stores: 4,
        products: 11,
        salesContents: 6,
        conversations: 3,
        orders: 10,
      });

      const repeated = await executeDemoSeed(request(), database);
      expect(repeated.counts).toEqual({
        created: 0,
        updated: 0,
        retired: 0,
        unchanged: 48,
      });

      const dryRun = await executeDemoSeed(request("--dry-run"), database);
      expect(dryRun.counts).toEqual(repeated.counts);
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

async function seededEntityCounts() {
  const rows = await sql<
    Array<{
      loginIdentities: number;
      stores: number;
      products: number;
      salesContents: number;
      conversations: number;
      orders: number;
    }>
  >`
    select
      (select count(*)::int from identity_login_methods
        where mobile between '09000000001' and '09000000005') as "loginIdentities",
      (select count(*)::int from store_stores
        where slug in ('aban-poosh', 'khane-narvan', 'kaghaz-o-rang', 'kargah-roshan')) as stores,
      (select count(*)::int from product_products product
        join store_stores store on store.id = product.store_id
        where store.slug in ('aban-poosh', 'khane-narvan', 'kaghaz-o-rang', 'kargah-roshan')) as products,
      (select count(*)::int from content_sales_contents content
        join store_stores store on store.id = content.store_id
        where store.slug in ('aban-poosh', 'khane-narvan', 'kaghaz-o-rang', 'kargah-roshan')) as "salesContents",
      (select count(*)::int from conversation_threads conversation
        join identity_login_methods login on login.identity_id = conversation.buyer_identity_id
        where login.mobile = '09000000001') as conversations,
      (select count(*)::int from order_orders orders
        join identity_login_methods login on login.identity_id = orders.identity_id
        where login.mobile = '09000000001') as orders
  `;
  return rows[0];
}
