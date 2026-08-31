import { readFileSync } from "node:fs";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDemoSeedRequest, executeDemoSeed } from "../../scripts/demo/runtime.mjs";
import { createPostgresDemoSeedDatabase } from "../../scripts/demo/postgres.mjs";
import { stableDemoId } from "../../scripts/demo/baseline.mjs";
import { createMediaDemoSeedAdapter } from "../../apps/api/src/modules/media/demo-seed.adapter.mjs";

const baselineManifest = JSON.parse(
  readFileSync(new URL("../../ops/demo/manifest.v1.json", import.meta.url), "utf8"),
);

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
      const humanIdentityId = "4d92ba57-2b63-4bbb-86ba-2cf8e68eb3fe";
      await sql`
        insert into identity_identities (id, status, created_at)
        values (${humanIdentityId}, 'ACTIVE', now()) on conflict (id) do nothing
      `;
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
      expect(await seedEvidence()).toMatchObject({
        humanIdentityStatus: "ACTIVE",
        missingMediaReferences: 0,
        mediaAssets: 17,
        orderTransitions: 19,
        paymentAudits: 24,
        refundAudits: 3,
        fulfillmentTimelineEntries: 21,
      });
      const media = createMediaDemoSeedAdapter();
      await expect(
        media.objectExists(`demo/${stableDemoId("product.tshirt.media")}/original`),
      ).resolves.toBe(true);

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

  it("retires removed canonical resources and projections, then restores them", async () => {
    const database = createPostgresDemoSeedDatabase(databaseUrl);
    const media = createMediaDemoSeedAdapter();
    const removedKey = "content.paper-poster";
    const removedOrderKey = "order.action-required";
    const removedId = stableDemoId(removedKey);
    const objectKey = `demo/${stableDemoId(`${removedKey}.media`)}/original`;
    try {
      const reduced = {
        ...baselineManifest,
        manifestVersion: 3,
        resources: baselineManifest.resources.filter(
          ({ key }) => ![removedKey, removedOrderKey].includes(key),
        ),
      };
      const report = await executeDemoSeed(request(), database, { manifest: reduced });
      expect(report.counts.retired).toBe(2);
      const [retired] = await sql`
        select seed.status, content.active,
          exists(select 1 from media_assets where id = ${stableDemoId(`${removedKey}.media`)}) as "mediaExists"
        from platform_seed_resources seed
        join content_sales_contents content on content.id = ${removedId}
        where seed.namespace = 'sevo.demo' and seed.resource_key = ${removedKey}
      `;
      expect(retired).toEqual({ status: "RETIRED", active: false, mediaExists: false });
      await expect(media.objectExists(objectKey)).resolves.toBe(false);
      const [retiredOrder] = await sql`
        select orders.status, fulfillment.status as "fulfillmentStatus",
          not exists(
            select 1 from reporting_seller_order_facts fact
            where fact.order_id = orders.id
          ) as "reportingRetired"
        from order_orders orders
        join fulfillment_orders fulfillment on fulfillment.order_id = orders.id
        where orders.id = ${stableDemoId(removedOrderKey)}
      `;
      expect(retiredOrder).toEqual({
        status: "CANCELLED",
        fulfillmentStatus: "CANCELLED",
        reportingRetired: true,
      });

      await executeDemoSeed(request(), database, {
        manifest: { ...baselineManifest, manifestVersion: 4 },
      });
      await expect(media.objectExists(objectKey)).resolves.toBe(true);
      const [restoredOrder] = await sql`
        select orders.status, fulfillment.status as "fulfillmentStatus",
          fulfillment.version, projection.version as "projectionVersion"
        from order_orders orders
        join fulfillment_orders fulfillment on fulfillment.order_id = orders.id
        join order_fulfillment_status_projections projection
          on projection.order_id = orders.id
        where orders.id = ${stableDemoId(removedOrderKey)}
      `;
      expect(restoredOrder).toEqual({
        status: "PAID",
        fulfillmentStatus: "ACTION_REQUIRED",
        version: 3,
        projectionVersion: 3,
      });
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

async function seedEvidence() {
  const humanIdentityId = "4d92ba57-2b63-4bbb-86ba-2cf8e68eb3fe";
  const [row] = await sql`
    select
      (select status from identity_identities where id = ${humanIdentityId}) as "humanIdentityStatus",
      (select count(*)::int from media_assets where original_object_key like 'demo/%') as "mediaAssets",
      (select count(*)::int from order_state_transitions where reason_code = 'DEMO_BASELINE') as "orderTransitions",
      (select count(*)::int from payment_attempt_audits where reason_code in
        ('ATTEMPT_CREATED', 'PROVIDER_DISPATCHED', 'PROVIDER_CONFIRMED', 'PROVIDER_PENDING')) as "paymentAudits",
      (select count(*)::int from payment_direct_refund_audits where actor_reference in
        (${stableDemoId("identity.seller")}, 'DEV')) as "refundAudits",
      (select count(*)::int from fulfillment_timeline_entries
        where correlation_id = any(
          ${baselineManifest.resources
            .filter(({ kind, fulfillment }) => kind === "order" && fulfillment)
            .flatMap((order) =>
              [1, 2, 3, 4].map((version) =>
                stableDemoId(`${order.key}.fulfillment-correlation.${version}`),
              ),
            )}
        )) as "fulfillmentTimelineEntries",
      (select count(*)::int
        from (
          select working.media_id from product_working_copies working
          left join media_assets media on media.id = working.media_id
          join product_products product on product.id = working.product_id
          where product.store_id in (${stableDemoId("store.aban")}, ${stableDemoId("store.narvan")},
            ${stableDemoId("store.paper")}, ${stableDemoId("store.roshan")}) and media.id is null
          union all
          select content.media_id from content_sales_contents content
          left join media_assets media on media.id = content.media_id
          where content.active = true and content.store_id in (${stableDemoId("store.aban")},
            ${stableDemoId("store.narvan")}, ${stableDemoId("store.paper")}) and media.id is null
        ) missing) as "missingMediaReferences"
  `;
  return row;
}
