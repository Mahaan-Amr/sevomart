import { readFileSync } from "node:fs";

import postgres from "postgres";
import { publicProductContract } from "@sevo/contracts/product/v1";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDemoSeedRequest, executeDemoSeed } from "../../scripts/demo/runtime.mjs";
import { createPostgresDemoSeedDatabase } from "../../scripts/demo/postgres.mjs";
import { stableDemoId } from "../../scripts/demo/baseline.mjs";
import { createMediaDemoSeedAdapter } from "../../apps/api/src/modules/media/demo-seed.composition.mjs";

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
      const publicationSnapshots = await sql<Array<{ snapshot: unknown }>>`
        select snapshot from product_publications
        where snapshot is not null and product_id in (
          select id from product_products where id in ${sql(
            baselineManifest.resources
              .filter(({ kind }) => kind === "product")
              .map(({ key }) => stableDemoId(key)),
          )}
        )
      `;
      expect(() => {
        for (const { snapshot } of publicationSnapshots) {
          publicProductContract.parse(snapshot);
        }
      }).not.toThrow();
      expect(await seedEvidence()).toMatchObject({
        humanIdentityStatus: "ACTIVE",
        missingMediaReferences: 0,
        mediaAssets: 17,
        orderTransitions: 19,
        paymentAudits: 24,
        refundAudits: 3,
        fulfillmentTimelineEntries: 21,
        pendingPaymentAgeMinutes: 5,
        reviewPaymentAgeMinutes: 120,
      });
      const media = createMediaDemoSeedAdapter();
      const [tshirtMedia] = await sql`
        select original_object_key as "objectKey" from media_assets
        where id = ${stableDemoId("product.tshirt.media")}
      `;
      await expect(media.objectExists(tshirtMedia.objectKey)).resolves.toBe(true);
      const beforeRepeat = await idempotencyEvidence();

      const repeated = await executeDemoSeed(request(), database);
      expect(repeated.counts).toEqual({
        created: 0,
        updated: 0,
        retired: 0,
        unchanged: 48,
      });
      expect(await idempotencyEvidence()).toEqual(beforeRepeat);

      await sql`
        update product_working_copies set name = 'نام آزمایشی خارج از baseline'
        where product_id = ${stableDemoId("product.tshirt")}
      `;
      await sql`
        update discovery_store_follows set status = 'INACTIVE',
          revision = revision + 1, deactivated_at = now()
        where relation_id = ${stableDemoId("follow.buyer-aban")}
      `;
      await sql`
        update discovery_follow_sets set revision = 5
        where identity_id = ${stableDemoId("identity.buyer")}
      `;
      await sql`
        update inventory_levels set on_hand = on_hand + 1, revision = revision + 1
        where variant_id = ${stableDemoId("product.tshirt.variant.white-small")}
      `;
      await sql`
        insert into order_saved_address_revisions
          (address_id, revision, recipient_name, recipient_mobile, province_text,
           city_text, address_line, postal_code, created_at)
        select address_id, 2, recipient_name, recipient_mobile, province_text,
          city_text, 'نشانی ویرایش‌شده نمایشی', postal_code, now()
        from order_saved_address_revisions
        where address_id = ${stableDemoId("address.buyer-home")} and revision = 1
        on conflict (address_id, revision) do nothing
      `;
      await sql`
        update order_saved_addresses set current_revision = 2
        where id = ${stableDemoId("address.buyer-home")}
      `;
      await sql`
        insert into identity_seller_application_revisions
          (id, application_id, revision, applicant_name, proposed_store_name,
           goods_area_text, current_sales_method, submitted_at)
        select ${stableDemoId("seller-application.pending.revision.drift")},
          application_id, 2, 'نام ویرایش‌شده', proposed_store_name,
          goods_area_text, current_sales_method, now()
        from identity_seller_application_revisions
        where application_id = ${stableDemoId("seller-application.pending")}
          and revision = 1
        on conflict (application_id, revision) do nothing
      `;
      await sql`
        update identity_seller_applications set current_revision = 2,
          aggregate_version = 2
        where id = ${stableDemoId("seller-application.pending")}
      `;
      await sql`
        insert into identity_platform_permission_grants
          (id, identity_id, permission, granted_at, revoked_at)
        values (${stableDemoId("platform-grant.access-manager.access_audit_review")},
          ${stableDemoId("identity.access-manager")}, 'ACCESS_AUDIT_REVIEW', now(), null)
        on conflict (id) do update set revoked_at = null
      `;
      const reconverged = await executeDemoSeed(request(), database);
      expect(reconverged.counts.unchanged).toBe(48);
      const [drift] = await sql`
        select
          (select name from product_working_copies
            where product_id = ${stableDemoId("product.tshirt")}) as name,
          (select status from discovery_store_follows
            where relation_id = ${stableDemoId("follow.buyer-aban")}) as "followStatus",
          (select revoked_at is not null from identity_platform_permission_grants
            where id = ${stableDemoId("platform-grant.access-manager.access_audit_review")})
            as "obsoletePermissionRevoked",
          (select current_revision from order_saved_addresses
            where id = ${stableDemoId("address.buyer-home")}) as "addressRevision",
          (select availability_version from discovery_product_feed_projections
            where product_id = ${stableDemoId("product.tshirt")})
            = (select max(revision) from inventory_levels
              where variant_id in (
                ${stableDemoId("product.tshirt.variant.white-small")},
                ${stableDemoId("product.tshirt.variant.white-medium")},
                ${stableDemoId("product.tshirt.variant.black-medium")}
              )) as "availabilityProjectionCurrent",
          (select revision from discovery_follow_sets
            where identity_id = ${stableDemoId("identity.buyer")}) as "followSetRevision",
          (select application.current_revision from identity_seller_applications application
            where application.id = ${stableDemoId("seller-application.pending")})
            as "applicationRevision",
          (select revision.applicant_name from identity_seller_applications application
            join identity_seller_application_revisions revision
              on revision.application_id = application.id
              and revision.revision = application.current_revision
            where application.id = ${stableDemoId("seller-application.pending")})
            as "applicationName"
      `;
      expect(drift).toEqual({
        name: baselineManifest.resources.find(({ key }) => key === "product.tshirt")
          .name,
        followStatus: "ACTIVE",
        obsoletePermissionRevoked: true,
        addressRevision: 1,
        availabilityProjectionCurrent: true,
        followSetRevision: 6,
        applicationRevision: 3,
        applicationName: baselineManifest.resources.find(
          ({ key }) => key === "seller-application.pending",
        ).applicantName,
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
    const removedProductKey = "product.poster";
    const removedOrderKey = "order.action-required";
    const removedCartKey = "cart.buyer-active";
    const removedAddressKey = "address.buyer-home";
    const removedFollowKey = "follow.buyer-paper";
    const removedId = stableDemoId(removedKey);
    const [removedMedia] = await sql`
      select original_object_key as "objectKey" from media_assets
      where id = ${stableDemoId(`${removedKey}.media`)}
    `;
    const objectKey = removedMedia.objectKey;
    const [productBeforeRetirement] = await sql`
      select revision, publication_version as "publicationVersion"
      from product_products where id = ${stableDemoId(removedProductKey)}
    `;
    const [followSetBeforeRetirement] = await sql`
      select revision from discovery_follow_sets
      where identity_id = ${stableDemoId("identity.buyer")}
    `;
    try {
      const reduced = {
        ...baselineManifest,
        manifestVersion: 3,
        resources: baselineManifest.resources.filter(
          ({ key }) =>
            ![
              removedKey,
              removedProductKey,
              removedOrderKey,
              removedCartKey,
              removedAddressKey,
              removedFollowKey,
            ].includes(key),
        ),
      };
      const report = await executeDemoSeed(request(), database, { manifest: reduced });
      expect(report.counts.retired).toBe(6);
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
      const [retiredProduct] = await sql`
        select state, revision, publication_version as "publicationVersion"
        from product_products where id = ${stableDemoId(removedProductKey)}
      `;
      expect(retiredProduct).toMatchObject({
        state: "UNPUBLISHED",
        revision: productBeforeRetirement.revision + 1,
        publicationVersion: productBeforeRetirement.publicationVersion + 1,
      });
      const [retiredRelationships] = await sql`
        select
          (select status from order_carts where id = ${stableDemoId(removedCartKey)})
            as "cartStatus",
          (select status from order_saved_addresses
            where id = ${stableDemoId(removedAddressKey)}) as "addressStatus",
          (select status from discovery_store_follows
            where relation_id = ${stableDemoId(removedFollowKey)}) as "followStatus",
          (select revision from discovery_follow_sets
            where identity_id = ${stableDemoId("identity.buyer")}) as "followSetRevision"
      `;
      expect(retiredRelationships).toEqual({
        cartStatus: "EXPIRED",
        addressStatus: "DELETED",
        followStatus: "INACTIVE",
        followSetRevision: followSetBeforeRetirement.revision + 1,
      });

      await executeDemoSeed(request(), database, {
        manifest: { ...baselineManifest, manifestVersion: 4 },
      });
      await expect(media.objectExists(objectKey)).resolves.toBe(true);
      const [productAfterRestoration] = await sql`
        select state, revision, publication_version as "publicationVersion"
        from product_products where id = ${stableDemoId(removedProductKey)}
      `;
      expect(productAfterRestoration).toMatchObject({
        state: "PUBLISHED",
        revision: retiredProduct.revision + 1,
        publicationVersion: retiredProduct.publicationVersion + 1,
      });
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

      const basePoster = baselineManifest.resources.find(
        ({ key }) => key === "product.poster",
      );
      const priceOnlyProduct = baselineManifest.resources.map((resource) =>
        resource.key === "product.poster"
          ? { ...resource, price: resource.price + 1000 }
          : resource,
      );
      const [beforeUpdate] = await sql`
        select revision, publication_version as "publicationVersion"
        from product_products where id = ${stableDemoId("product.poster")}
      `;
      const priceReport = await executeDemoSeed(request(), database, {
        manifest: {
          ...baselineManifest,
          manifestVersion: 5,
          resources: priceOnlyProduct,
        },
      });
      expect(priceReport.counts.updated).toBe(1);
      const [priceUpdated] = await sql`
        select product.revision, product.publication_version as "publicationVersion",
          offer.amount::int, offer.revision as "offerVersion"
        from product_products product
        join product_offers offer on offer.product_id = product.id
        where product.id = ${stableDemoId("product.poster")}
        limit 1
      `;
      expect(priceUpdated).toEqual({
        ...beforeUpdate,
        amount: basePoster.price + 1000,
        offerVersion: 2,
      });
      const [offerProjection] = await sql`
        select offer_version as "offerVersion"
        from discovery_product_feed_projections
        where product_id = ${stableDemoId("product.poster")}
      `;
      expect(offerProjection.offerVersion).toBe(priceUpdated.offerVersion);
      const changedProduct = baselineManifest.resources.map((resource) =>
        resource.key === "product.poster"
          ? { ...resource, name: "پوستر نسخه تازه" }
          : resource,
      );
      const updateReport = await executeDemoSeed(request(), database, {
        manifest: {
          ...baselineManifest,
          manifestVersion: 6,
          resources: changedProduct,
        },
      });
      expect(updateReport.counts.updated).toBe(1);
      const [updated] = await sql`
        select product.revision, product.publication_version as "publicationVersion",
          working.name, offer.amount::int
        from product_products product
        join product_working_copies working on working.product_id = product.id
        join product_offers offer on offer.product_id = product.id
        where product.id = ${stableDemoId("product.poster")}
        limit 1
      `;
      expect(updated).toMatchObject({
        revision: priceUpdated.revision + 1,
        publicationVersion: priceUpdated.publicationVersion + 1,
        name: "پوستر نسخه تازه",
      });
      expect(updated.amount).toBe(basePoster.price);
      await executeDemoSeed(request(), database, {
        manifest: { ...baselineManifest, manifestVersion: 7 },
      });
      const [restoredProduct] = await sql`
        select product.revision, product.publication_version as "publicationVersion",
          working.name
        from product_products product
        join product_working_copies working on working.product_id = product.id
        where product.id = ${stableDemoId("product.poster")}
      `;
      expect(restoredProduct).toMatchObject({
        revision: updated.revision + 1,
        publicationVersion: updated.publicationVersion + 1,
        name: basePoster.name,
      });

      const tshirt = baselineManifest.resources.find(
        ({ key }) => key === "product.tshirt",
      );
      const removedVariant = tshirt.variants[1];
      const [tshirtBeforeVariantChange] = await sql`
        select revision, publication_version as "publicationVersion"
        from product_products where id = ${stableDemoId(tshirt.key)}
      `;
      const reducedVariants = baselineManifest.resources.map((resource) =>
        resource.key === tshirt.key
          ? { ...resource, variants: resource.variants.slice(0, 1) }
          : resource,
      );
      await executeDemoSeed(request(), database, {
        manifest: {
          ...baselineManifest,
          manifestVersion: 8,
          resources: reducedVariants,
        },
      });
      const variantId = stableDemoId(`${tshirt.key}.variant.${removedVariant.key}`);
      const [retiredVariant] = await sql`
        select variant.retired, inventory.on_hand as "onHand"
        from product_variants variant
        join inventory_levels inventory on inventory.variant_id = variant.id
        where variant.id = ${variantId}
      `;
      expect(retiredVariant).toEqual({ retired: true, onHand: 0 });
      const [tshirtAfterVariantChange] = await sql`
        select revision, publication_version as "publicationVersion"
        from product_products where id = ${stableDemoId(tshirt.key)}
      `;
      expect(tshirtAfterVariantChange).toEqual({
        revision: tshirtBeforeVariantChange.revision + 1,
        publicationVersion: tshirtBeforeVariantChange.publicationVersion + 1,
      });
      await executeDemoSeed(request(), database, {
        manifest: { ...baselineManifest, manifestVersion: 9 },
      });
      const [restoredVariant] = await sql`
        select variant.retired, inventory.on_hand as "onHand"
        from product_variants variant
        join inventory_levels inventory on inventory.variant_id = variant.id
        where variant.id = ${variantId}
      `;
      expect(restoredVariant).toEqual({
        retired: false,
        onHand: removedVariant.onHand,
      });

      const relationshipResources = baselineManifest.resources.map((resource) => {
        if (resource.key === "product.poster")
          return { ...resource, store: "store.narvan" };
        if (resource.key === "content.paper-poster")
          return {
            ...resource,
            store: "store.narvan",
            product: "product.mug",
          };
        if (resource.key === "follow.buyer-aban")
          return { ...resource, store: "store.narvan" };
        if (resource.kind === "cart") return { ...resource, product: "product.tshirt" };
        return resource;
      });
      const [cartBeforeRelationshipChange] = await sql`
        select revision from order_carts where id = ${stableDemoId("cart.buyer-active")}
      `;
      await executeDemoSeed(request(), database, {
        manifest: {
          ...baselineManifest,
          manifestVersion: 10,
          resources: relationshipResources,
        },
      });
      const [relationships] = await sql`
        select
          (select store_id = ${stableDemoId("store.narvan")} from product_products
            where id = ${stableDemoId("product.poster")}) as "productMoved",
          (select store_id = ${stableDemoId("store.narvan")} from inventory_levels
            where variant_id = ${stableDemoId("product.poster.variant.simple")})
            as "inventoryMoved",
          (select store_id = ${stableDemoId("store.narvan")} from content_sales_contents
            where id = ${stableDemoId("content.paper-poster")}) as "contentMoved",
          (select active = false from content_sales_content_products
            where content_id = ${stableDemoId("content.paper-poster")}
              and product_id = ${stableDemoId("product.poster")}) as "oldLinkRetired",
          (select active = true from content_sales_content_products
            where content_id = ${stableDemoId("content.paper-poster")}
              and product_id = ${stableDemoId("product.mug")}) as "newLinkActive",
          (select store_id = ${stableDemoId("store.narvan")} from discovery_store_follows
            where relation_id = ${stableDemoId("follow.buyer-aban")}) as "followMoved",
          (select count(*)::int = 1 and bool_and(product_id = ${stableDemoId("product.tshirt")})
            from order_cart_items where cart_id = ${stableDemoId("cart.buyer-active")})
            as "cartReplaced",
          (select revision from order_carts where id = ${stableDemoId("cart.buyer-active")})
            as "cartRevision"
      `;
      expect(relationships).toEqual({
        productMoved: true,
        inventoryMoved: true,
        contentMoved: true,
        oldLinkRetired: true,
        newLinkActive: true,
        followMoved: true,
        cartReplaced: true,
        cartRevision: cartBeforeRelationshipChange.revision + 1,
      });
      await executeDemoSeed(request(), database, {
        manifest: { ...baselineManifest, manifestVersion: 11 },
      });
      const [restoredCart] = await sql`
        select revision from order_carts where id = ${stableDemoId("cart.buyer-active")}
      `;
      expect(restoredCart.revision).toBe(relationships.cartRevision + 1);
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

async function idempotencyEvidence() {
  const [evidence] = await sql`
    select
      (select revision from discovery_store_follows
        where relation_id = ${stableDemoId("follow.buyer-aban")}) as "followRevision",
      (select version from conversation_threads
        where id = ${stableDemoId("conversation.order")}) as "conversationVersion",
      (select updated_at from platform_seed_resources
        where namespace = 'sevo.demo' and resource_key = 'product.tshirt') as "trackedAt",
      (select expires_at from order_carts
        where id = ${stableDemoId("cart.buyer-active")}) as "cartExpiresAt",
      (select updated_at from product_products
        where id = ${stableDemoId("product.tshirt")}) as "productUpdatedAt",
      (select updated_at from discovery_product_feed_projections
        where product_id = ${stableDemoId("product.tshirt")}) as "projectionUpdatedAt"
  `;
  return evidence;
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
      (select round(extract(epoch from (now() - created_at)) / 60)::int
        from order_orders where id = ${stableDemoId("order.pending-payment")})
        as "pendingPaymentAgeMinutes",
      (select round(extract(epoch from (now() - created_at)) / 60)::int
        from payment_attempts where id = ${stableDemoId("order.payment-review.payment")})
        as "reviewPaymentAgeMinutes",
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
