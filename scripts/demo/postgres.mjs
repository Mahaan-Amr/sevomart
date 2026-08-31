import postgres from "postgres";

import {
  buildDemoBaseline,
  manifestResources,
  manifestSummary,
  stableDemoId,
} from "./baseline.mjs";

export function createPostgresDemoSeedDatabase(databaseUrl) {
  const sql = postgres(databaseUrl, { max: 2 });

  return {
    async inspectTarget() {
      const targets = await sql`
        select database_name as "databaseName", fingerprint::text, profile
        from platform_data_environment
        where singleton = true
      `;
      const target = targets[0];
      if (!target) throw new Error("Database target fingerprint is not registered");
      return target;
    },

    async withNamespaceLock(namespace, operation) {
      const connection = await sql.reserve();
      try {
        const locks = await connection`
          select pg_try_advisory_lock(hashtextextended(${namespace}, 0)) as acquired
        `;
        if (!locks[0]?.acquired) {
          throw new Error(`demo:seed is already running for namespace ${namespace}`);
        }
        return await operation();
      } finally {
        await connection`
          select pg_advisory_unlock(hashtextextended(${namespace}, 0))
        `;
        connection.release();
      }
    },

    async planManifest(manifest) {
      const desired = manifestResources(manifest);
      const current = await sql`
        select resource_key as key, content_checksum as checksum, status
        from platform_seed_resources
        where namespace = ${manifest.namespace}
      `;
      const existing = new Map(current.map((item) => [item.key, item]));
      const desiredKeys = new Set(desired.map(({ key }) => key));
      const counts = { created: 0, updated: 0, retired: 0, unchanged: 0 };
      for (const resource of desired) {
        const previous = existing.get(resource.key);
        if (!previous || previous.status === "RETIRED") counts.created += 1;
        else if (previous.checksum !== resource.checksum) counts.updated += 1;
        else counts.unchanged += 1;
      }
      counts.retired = current.filter(
        ({ key, status }) => status === "ACTIVE" && !desiredKeys.has(key),
      ).length;
      return { counts, entities: manifestSummary(manifest) };
    },

    async applyManifest(manifest, now, report) {
      await sql.begin(async (transaction) => {
        await convergeCanonicalBaseline(transaction, manifest, now);
        const desired = manifestResources(manifest);
        const desiredKeys = desired.map(({ key }) => key);
        await transaction`
          update platform_seed_resources
          set status = 'RETIRED', manifest_version = ${manifest.manifestVersion},
            updated_at = ${now}
          where namespace = ${manifest.namespace}
            and status = 'ACTIVE'
            and resource_key <> all(${desiredKeys})
        `;
        for (const resource of desired) {
          await transaction`
            insert into platform_seed_resources
              (namespace, resource_key, resource_kind, resource_id, manifest_version,
               content_checksum, status, updated_at)
            values
              (${manifest.namespace}, ${resource.key}, ${resource.kind}, ${resource.id},
               ${manifest.manifestVersion}, ${resource.checksum}, 'ACTIVE', ${now})
            on conflict (namespace, resource_key) do update set
              resource_kind = excluded.resource_kind,
              resource_id = excluded.resource_id,
              manifest_version = excluded.manifest_version,
              content_checksum = excluded.content_checksum,
              status = 'ACTIVE',
              updated_at = excluded.updated_at
          `;
        }
        await transaction`
          insert into platform_seed_manifest_receipts
            (namespace, manifest_version, target_fingerprint, report, applied_at)
          select ${report.namespace}, ${report.manifestVersion}, fingerprint,
            ${transaction.json(report)}, ${now}
          from platform_data_environment
          where singleton = true
          on conflict (namespace) do update set
            manifest_version = excluded.manifest_version,
            target_fingerprint = excluded.target_fingerprint,
            report = excluded.report,
            applied_at = excluded.applied_at
        `;
      });
    },

    async close() {
      await sql.end({ timeout: 1 });
    },
  };
}

async function convergeCanonicalBaseline(sql, manifest, now) {
  const baseline = buildDemoBaseline(manifest, now);
  await seedIdentities(sql, manifest, baseline);
  await seedStores(sql, baseline);
  await seedProducts(sql, baseline);
  await seedBuyerState(sql, manifest, baseline);
  await seedContentAndConversations(sql, manifest, baseline);
  await seedOrders(sql, manifest, baseline);
  await rebuildDemoProjections(sql, baseline);
}

async function seedIdentities(sql, manifest, baseline) {
  const { id } = baseline.ids;
  const identities = manifest.resources.filter(({ kind }) => kind === "loginIdentity");
  for (const store of baseline.stores) {
    if (typeof store.owner !== "string") {
      identities.push({
        key: store.owner.key,
        name: store.owner.name,
        kind: "backgroundIdentity",
      });
    }
  }
  for (const identity of identities) {
    await sql`
      insert into identity_identities (id, status, created_at)
      values (${id(identity.key)}, 'ACTIVE', ${baseline.atDaysAgo(40)})
      on conflict (id) do update set status = 'ACTIVE'
    `;
    if (identity.mobile) {
      await sql`
        insert into identity_login_methods
          (id, identity_id, kind, mobile, verified_at, created_at)
        values (${id(`${identity.key}.mobile`)}, ${id(identity.key)}, 'MOBILE',
          ${identity.mobile}, ${baseline.atDaysAgo(40)}, ${baseline.atDaysAgo(40)})
        on conflict (id) do update set mobile = excluded.mobile,
          verified_at = excluded.verified_at
      `;
    }
  }

  const sellerKeys = new Set(baseline.stores.map((store) => baseline.ownerKey(store)));
  for (const sellerKey of sellerKeys) {
    await sql`
      insert into identity_seller_access (id, identity_id, status, created_at)
      values (${id(`${sellerKey}.seller-access`)}, ${id(sellerKey)}, 'ACTIVE',
        ${baseline.atDaysAgo(35)})
      on conflict (id) do update set status = 'ACTIVE'
    `;
  }

  const application = manifest.resources.find(
    ({ kind }) => kind === "sellerApplication",
  );
  await sql`
    insert into identity_seller_applications
      (id, identity_id, status, current_revision, aggregate_version, created_at,
       last_submitted_at)
    values (${id(application.key)}, ${id(application.identity)}, 'SUBMITTED', 1, 1,
      ${baseline.atDaysAgo(3)}, ${baseline.atDaysAgo(3)})
    on conflict (id) do update set status = 'SUBMITTED', current_revision = 1,
      aggregate_version = 1, last_submitted_at = excluded.last_submitted_at,
      completed_at = null
  `;
  await sql`
    insert into identity_seller_application_revisions
      (id, application_id, revision, applicant_name, proposed_store_name,
       goods_area_text, current_sales_method, submitted_at)
    values (${id(`${application.key}.revision.1`)}, ${id(application.key)}, 1,
      ${application.applicantName}, ${application.storeName}, ${application.goodsArea},
      ${application.salesMethod}, ${baseline.atDaysAgo(3)})
    on conflict (id) do update set applicant_name = excluded.applicant_name,
      proposed_store_name = excluded.proposed_store_name,
      goods_area_text = excluded.goods_area_text,
      current_sales_method = excluded.current_sales_method,
      submitted_at = excluded.submitted_at
  `;

  for (const grant of manifest.resources.filter(
    ({ kind }) => kind === "platformGrant",
  )) {
    for (const permission of grant.permissions) {
      const grantKey = `${grant.key}.${permission.toLowerCase()}`;
      await sql`
        insert into identity_platform_permission_grants
          (id, identity_id, permission, granted_at, revoked_at)
        values (${id(grantKey)}, ${id(grant.identity)}, ${permission},
          ${baseline.atDaysAgo(30)}, null)
        on conflict (id) do update set revoked_at = null
      `;
    }
  }
}

async function seedStores(sql, baseline) {
  const { id } = baseline.ids;
  for (const store of baseline.stores) {
    const published = store.status === "PUBLISHED";
    const owner = baseline.ownerKey(store);
    await sql`
      insert into store_stores
        (id, name, slug, bio, return_policy, settlement_kind, settlement_status,
         theme_color, status, published_at, updated_at, publication_version,
         revision, return_policy_revision)
      values (${id(store.key)}, ${store.name}, ${store.slug}, ${store.bio},
        'تا ۷ روز پس از تحویل، درخواست مرجوعی را با فروشنده هماهنگ کنید.',
        'DIRECT', 'ACTIVE', ${store.themeColor}, ${store.status},
        ${published ? baseline.atDaysAgo(30) : null}, ${baseline.now},
        ${published ? 1 : 0}, 1, 1)
      on conflict (id) do update set name = excluded.name, slug = excluded.slug,
        bio = excluded.bio, return_policy = excluded.return_policy,
        settlement_kind = excluded.settlement_kind,
        settlement_status = excluded.settlement_status, theme_color = excluded.theme_color,
        status = excluded.status, published_at = excluded.published_at,
        updated_at = excluded.updated_at, publication_version = excluded.publication_version,
        revision = excluded.revision, return_policy_revision = excluded.return_policy_revision
    `;
    await sql`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${id(`${store.key}.membership`)}, ${id(store.key)}, ${id(owner)}, 'OWNER')
      on conflict (id) do update set seller_id = excluded.seller_id, role = 'OWNER'
    `;
    await sql`
      insert into store_shipping_methods
        (id, store_id, position, code, label, revision, fixed_fee_amount, currency,
         estimated_delivery_text, enabled, requires_delivery_address,
         requires_postal_code)
      values (${id(`${store.key}.shipping`)}, ${id(store.key)}, 1, 'NATIONAL_POST',
        'پست پیشتاز', 1, 850000, 'IRR', '۳ تا ۵ روز کاری', true, true, true)
      on conflict (id) do update set label = excluded.label,
        fixed_fee_amount = excluded.fixed_fee_amount,
        estimated_delivery_text = excluded.estimated_delivery_text, enabled = true
    `;
  }
}

async function seedProducts(sql, baseline) {
  const { id } = baseline.ids;
  for (const product of baseline.products) {
    const publishedBefore = product.state !== "DRAFT";
    const publicationVersion = publishedBefore ? 1 : 0;
    const variants = baseline.variantsFor(product);
    const definition = {
      name: product.name,
      description: `نمونه نمایشی ${product.name}`,
      axes: product.variants ? ["رنگ و اندازه"] : [],
      variants: variants.map((variant) => ({
        clientKey: variant.key,
        label: variant.label,
      })),
    };
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at,
         created_at, updated_at)
      values (${id(product.key)}, ${id(product.store)}, ${product.state}, 1,
        ${publicationVersion}, ${publishedBefore ? baseline.atDaysAgo(20) : null},
        ${baseline.atDaysAgo(25)}, ${baseline.now})
      on conflict (id) do update set state = excluded.state, revision = excluded.revision,
        publication_version = excluded.publication_version,
        published_at = excluded.published_at, updated_at = excluded.updated_at
    `;
    await sql`
      insert into product_working_copies
        (product_id, name, description, media_id, variant_id, definition)
      values (${id(product.key)}, ${product.name}, ${`نمونه نمایشی ${product.name}`},
        ${id(`${product.key}.media`)}, null, ${sql.json(definition)})
      on conflict (product_id) do update set name = excluded.name,
        description = excluded.description, media_id = excluded.media_id,
        definition = excluded.definition
    `;
    if (publishedBefore) {
      await sql`
        insert into product_publications
          (product_id, publication_version, name, description, media_id, variant_id,
           snapshot, created_at)
        values (${id(product.key)}, 1, ${product.name},
          ${`نمونه نمایشی ${product.name}`}, ${id(`${product.key}.media`)},
          ${id(`${product.key}.variant.${variants[0].key}`)}, ${sql.json(definition)},
          ${baseline.atDaysAgo(20)})
        on conflict (product_id, publication_version) do update set
          name = excluded.name, description = excluded.description,
          media_id = excluded.media_id, snapshot = excluded.snapshot
      `;
    }
    for (const variant of variants) {
      const variantId = id(`${product.key}.variant.${variant.key}`);
      await sql`
        insert into product_variants
          (id, product_id, store_id, client_key, combination_key, retired,
           ever_published, created_at)
        values (${variantId}, ${id(product.key)}, ${id(product.store)}, ${variant.key},
          ${variant.label}, false, ${publishedBefore}, ${baseline.atDaysAgo(25)})
        on conflict (id) do update set retired = false,
          ever_published = excluded.ever_published
      `;
      await sql`
        insert into product_offers
          (product_id, variant_id, amount, currency, revision, sku)
        values (${id(product.key)}, ${variantId}, ${product.price}, 'IRR', 1,
          ${`DEMO-${product.key.split(".").at(-1)}-${variant.key}`})
        on conflict (variant_id) do update set amount = excluded.amount,
          revision = excluded.revision, sku = excluded.sku
      `;
      await sql`
        insert into inventory_levels (variant_id, store_id, on_hand, revision, updated_at)
        values (${variantId}, ${id(product.store)}, ${variant.onHand ?? 0}, 1,
          ${baseline.now})
        on conflict (variant_id) do update set on_hand = excluded.on_hand,
          revision = excluded.revision, updated_at = excluded.updated_at
      `;
    }
  }
}

async function seedBuyerState(sql, manifest, baseline) {
  const { id, firstVariant } = baseline.ids;
  for (const follow of manifest.resources.filter(({ kind }) => kind === "follow")) {
    await sql`
      insert into discovery_store_follows
        (relation_id, identity_id, store_id, status, revision, activated_at,
         deactivated_at, updated_at)
      values (${id(follow.key)}, ${id(follow.identity)}, ${id(follow.store)},
        'ACTIVE', 1, ${baseline.atDaysAgo(15)}, null, ${baseline.atDaysAgo(15)})
      on conflict (relation_id) do update set status = 'ACTIVE', revision = 1,
        updated_at = excluded.updated_at
    `;
  }
  await sql`
    insert into discovery_follow_sets (identity_id, revision, updated_at)
    values (${id("identity.buyer")}, 2, ${baseline.atDaysAgo(15)})
    on conflict (identity_id) do update set revision = 2, updated_at = excluded.updated_at
  `;
  await sql`
    insert into discovery_identity_status_projections
      (identity_id, status, status_version, updated_at)
    values (${id("identity.buyer")}, 'ACTIVE', 1, ${baseline.now})
    on conflict (identity_id) do update set status = 'ACTIVE',
      status_version = 1, updated_at = excluded.updated_at
  `;

  const cart = manifest.resources.find(({ kind }) => kind === "cart");
  await sql`
    insert into order_carts
      (id, store_id, identity_id, status, revision, expires_at, created_at,
       updated_at, reviewed_policy_revision, reviewed_shipping_hash)
    values (${id(cart.key)}, ${id(cart.store)}, ${id(cart.identity)}, 'ACTIVE', 1,
      ${new Date(baseline.now.getTime() + 7 * 86_400_000)}, ${baseline.atDaysAgo(1)},
      ${baseline.now}, 0, '')
    on conflict (id) do update set status = 'ACTIVE', revision = 1,
      expires_at = excluded.expires_at, updated_at = excluded.updated_at
  `;
  await sql`
    insert into order_cart_items
      (cart_id, variant_id, product_id, quantity, created_at, updated_at,
       reviewed_publication_version, reviewed_unit_price_amount)
    values (${id(cart.key)}, ${firstVariant(cart.product)}, ${id(cart.product)},
      ${cart.quantity}, ${baseline.atDaysAgo(1)}, ${baseline.now}, 0, 0)
    on conflict (cart_id, variant_id) do update set quantity = excluded.quantity,
      updated_at = excluded.updated_at
  `;

  const address = manifest.resources.find(({ kind }) => kind === "address");
  await sql`
    insert into order_saved_addresses
      (id, identity_id, current_revision, status, created_at, updated_at)
    values (${id(address.key)}, ${id(address.identity)}, 1, 'ACTIVE',
      ${baseline.atDaysAgo(20)}, ${baseline.now})
    on conflict (id) do update set status = 'ACTIVE', current_revision = 1,
      updated_at = excluded.updated_at
  `;
  await sql`
    insert into order_saved_address_revisions
      (address_id, revision, recipient_name, recipient_mobile, province_text,
       city_text, address_line, postal_code, created_at)
    values (${id(address.key)}, 1, ${address.recipient}, ${address.mobile},
      ${address.province}, ${address.city}, ${address.line}, ${address.postalCode},
      ${baseline.atDaysAgo(20)})
    on conflict (address_id, revision) do update set
      recipient_name = excluded.recipient_name, recipient_mobile = excluded.recipient_mobile,
      province_text = excluded.province_text, city_text = excluded.city_text,
      address_line = excluded.address_line, postal_code = excluded.postal_code
  `;
}

async function seedContentAndConversations(sql, manifest, baseline) {
  const { id, storeOwnerId } = baseline.ids;
  for (const content of manifest.resources.filter(
    ({ kind }) => kind === "salesContent",
  )) {
    await sql`
      insert into content_sales_contents
        (id, store_id, actor_identity_id, source, moderation_state, media_id,
         media_kind, active, created_at)
      values (${id(content.key)}, ${id(content.store)}, ${storeOwnerId(content.store)},
        'SELLER', 'PUBLISHED', ${id(`${content.key}.media`)}, ${content.mediaKind}, true,
        ${baseline.atDaysAgo(content.ageDays)})
      on conflict (id) do update set moderation_state = 'PUBLISHED', active = true,
        media_id = excluded.media_id, media_kind = excluded.media_kind,
        created_at = excluded.created_at
    `;
    await sql`
      insert into content_sales_content_products
        (content_id, product_id, publication_version, active)
      values (${id(content.key)}, ${id(content.product)}, 1, true)
      on conflict (content_id, product_id) do update set active = true,
        publication_version = 1
    `;
  }
  for (const product of baseline.products.filter(({ state }) => state !== "DRAFT")) {
    await sql`
      insert into content_product_states
        (product_id, aggregate_version, publication_version, active, updated_at)
      values (${id(product.key)}, 1, 1, ${product.state === "PUBLISHED"}, ${baseline.now})
      on conflict (product_id) do update set aggregate_version = 1,
        publication_version = 1, active = excluded.active, updated_at = excluded.updated_at
    `;
  }
  for (const conversation of manifest.resources.filter(
    ({ kind }) => kind === "conversation",
  )) {
    const contextId = id(conversation.context);
    await sql`
      insert into conversation_threads
        (id, buyer_identity_id, seller_identity_id, store_id, context_kind,
         context_reference_id, context, version, created_at, updated_at)
      values (${id(conversation.key)}, ${id(conversation.buyer)},
        ${storeOwnerId(conversation.store)}, ${id(conversation.store)},
        ${conversation.contextKind}, ${contextId},
        ${sql.json({ title: conversation.message })}, 1, ${baseline.atDaysAgo(2)},
        ${baseline.atDaysAgo(1)})
      on conflict (id) do update set context = excluded.context, version = 1,
        updated_at = excluded.updated_at
    `;
    await sql`
      insert into conversation_messages
        (id, conversation_id, sender_role, content, created_at)
      values (${id(`${conversation.key}.message`)}, ${id(conversation.key)}, 'BUYER',
        ${sql.json({ text: conversation.message, attachments: [] })},
        ${baseline.atDaysAgo(1)})
      on conflict (id) do update set content = excluded.content,
        created_at = excluded.created_at
    `;
  }
}

async function seedOrders(sql, manifest, baseline) {
  const { id, firstVariant } = baseline.ids;
  const buyerId = id("identity.buyer");
  const storeId = id("store.aban");
  const addressId = id("address.buyer-home");
  const shippingId = id("store.aban.shipping");
  for (const order of baseline.orders) {
    const product = baseline.resources.get(order.product);
    const createdAt = baseline.atDaysAgo(order.ageDays);
    const cartId = id(`${order.key}.cart`);
    const checkoutId = id(`${order.key}.checkout`);
    const orderId = id(order.key);
    const variantId = firstVariant(order.product);
    const totalAmount = product.price + 850000;
    await sql`
      insert into order_carts
        (id, store_id, identity_id, status, revision, expires_at, created_at,
         updated_at, reviewed_policy_revision, reviewed_shipping_hash)
      values (${cartId}, ${storeId}, ${buyerId}, 'CONVERTED', 1, ${createdAt},
        ${createdAt}, ${createdAt}, 1,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      on conflict (id) do update set status = 'CONVERTED', updated_at = excluded.updated_at
    `;
    await sql`
      insert into order_checkout_preparations
        (checkout_revision, identity_id, cart_id, cart_revision, address_id,
         address_revision, shipping_method_id, shipping_revision, policy_revision,
         snapshot, expires_at, consumed_order_id, created_at)
      values (${checkoutId}, ${buyerId}, ${cartId}, 1, ${addressId}, 1,
        ${shippingId}, 1, 1, ${sql.json({ product: product.name })},
        ${new Date(createdAt.getTime() + 15 * 60_000)}, null, ${createdAt})
      on conflict (checkout_revision) do update set snapshot = excluded.snapshot,
        expires_at = excluded.expires_at, consumed_order_id = null
    `;
    await sql`
      insert into order_orders
        (id, identity_id, store_id, checkout_revision, reservation_id, status,
         total_amount, currency, reservation_expires_at, review_snapshot,
         created_at, paid_at)
      values (${orderId}, ${buyerId}, ${storeId}, ${checkoutId},
        ${id(`${order.key}.reservation`)}, ${order.state}, ${totalAmount}, 'IRR',
        ${new Date(createdAt.getTime() + 15 * 60_000)},
        ${sql.json({ settlementKind: "DIRECT", product: product.name })},
        ${createdAt}, ${["PENDING_PAYMENT", "PAYMENT_REVIEW", "EXPIRED"].includes(order.state) ? null : createdAt})
      on conflict (id) do update set status = excluded.status,
        total_amount = excluded.total_amount, review_snapshot = excluded.review_snapshot,
        created_at = excluded.created_at, paid_at = excluded.paid_at
    `;
    await sql`
      update order_checkout_preparations set consumed_order_id = ${orderId}
      where checkout_revision = ${checkoutId}
    `;
    await sql`
      insert into order_items
        (id, order_id, variant_id, product_id, name, quantity,
         unit_price_amount, publication_version)
      values (${id(`${order.key}.item`)}, ${orderId}, ${variantId}, ${id(order.product)},
        ${product.name}, 1, ${product.price}, 1)
      on conflict (order_id, variant_id) do update set name = excluded.name,
        unit_price_amount = excluded.unit_price_amount
    `;
    await seedOrderSnapshots(sql, baseline, orderId, addressId, shippingId);
    await seedPayment(sql, baseline, order, totalAmount);
    await seedFulfillment(sql, baseline, order);
  }

  const experience = manifest.resources.find(
    ({ kind }) => kind === "purchaseExperience",
  );
  await sql`
    insert into content_purchase_experiences
      (id, buyer_identity_id, order_item_id, store_id, product_id, source,
       moderation_state, rating, text, media_ids, created_at)
    values (${id(experience.key)}, ${buyerId}, ${id(`${experience.order}.item`)},
      ${storeId}, ${id(experience.product)}, 'VERIFIED_PURCHASE', 'PUBLISHED',
      ${experience.rating}, ${experience.text}, '{}', ${baseline.atDaysAgo(14)})
    on conflict (id) do update set rating = excluded.rating, text = excluded.text,
      moderation_state = 'PUBLISHED'
  `;

  const dispute = manifest.resources.find(({ kind }) => kind === "dispute");
  await sql`
    insert into problem_disputes
      (id, order_id, buyer_identity_id, store_id, status, category, opened_at,
       deadline_kind, deadline_at, contributions, outcome, version, updated_at)
    values (${id(dispute.key)}, ${id(dispute.order)}, ${buyerId}, ${storeId},
      ${dispute.status}, ${dispute.category}, ${baseline.atDaysAgo(2)},
      'PLATFORM_REVIEW', ${new Date(baseline.now.getTime() + 2 * 86_400_000)},
      ${sql.json([
        {
          actor: "BUYER",
          text: "رنگ کالا با توضیح سفارش یکسان نبود.",
          evidence: ["demo-evidence-buyer"],
        },
        {
          actor: "SELLER",
          text: "تصویر بسته‌بندی و گونه ارسال‌شده پیوست شد.",
          evidence: ["demo-evidence-seller"],
        },
      ])}, null, 2, ${baseline.now})
    on conflict (id) do update set status = excluded.status,
      contributions = excluded.contributions, version = excluded.version,
      updated_at = excluded.updated_at
  `;
  await sql`
    insert into problem_dispute_audits
      (id, dispute_id, action, actor_kind, actor_identity_id, from_status,
       to_status, reason_code, evidence_count, correlation_id, occurred_at)
    values (${id(`${dispute.key}.audit`)}, ${id(dispute.key)}, 'REVIEW',
      'PLATFORM_AGENT', ${id("identity.reviewer")}, 'AWAITING_SELLER_RESPONSE',
      'UNDER_REVIEW', 'EVIDENCE_RECEIVED', 2, ${id(`${dispute.key}.correlation`)},
      ${baseline.atDaysAgo(1)})
    on conflict (id) do nothing
  `;
}

async function seedOrderSnapshots(sql, baseline, orderId, addressId, shippingId) {
  await sql`
    insert into order_delivery_snapshots
      (order_id, address_id, address_revision, recipient_name, recipient_mobile,
       province_text, city_text, address_line, postal_code)
    values (${orderId}, ${addressId}, 1, 'نیلوفر مرادی', '09000000001',
      'تهران', 'تهران', 'خیابان نمونه، کوچه آزمایش، پلاک ۱۲', '1234567890')
    on conflict (order_id) do update set recipient_name = excluded.recipient_name,
      address_line = excluded.address_line
  `;
  await sql`
    insert into order_shipping_snapshots
      (order_id, shipping_method_id, shipping_method_revision, code, label,
       fee_amount, estimated_delivery_text)
    values (${orderId}, ${shippingId}, 1, 'NATIONAL_POST', 'پست پیشتاز',
      850000, '۳ تا ۵ روز کاری')
    on conflict (order_id) do update set fee_amount = excluded.fee_amount,
      estimated_delivery_text = excluded.estimated_delivery_text
  `;
  await sql`
    insert into order_policy_snapshots (order_id, revision, text)
    values (${orderId}, 1,
      'تا ۷ روز پس از تحویل، درخواست مرجوعی را با فروشنده هماهنگ کنید.')
    on conflict (order_id) do update set text = excluded.text
  `;
}

async function seedPayment(sql, baseline, order, totalAmount) {
  if (["PENDING_PAYMENT", "EXPIRED"].includes(order.state)) return;
  const { id } = baseline.ids;
  const status = order.payment ?? "CONFIRMED";
  const attemptId = id(`${order.key}.payment`);
  const providerScenario = status === "REVIEW_REQUIRED" ? "pending" : "success";
  await sql`
    insert into payment_attempts
      (id, order_id, identity_id, status, amount, currency, provider,
       provider_reference, redirect_url, created_at, dispatched_at, confirmed_at)
    values (${attemptId}, ${id(order.key)}, ${id("identity.buyer")}, ${status},
      ${totalAmount}, 'IRR', 'DEV',
      ${`dev-scenario-${providerScenario}-${attemptId}`}, null,
      ${baseline.atDaysAgo(order.ageDays)}, ${baseline.atDaysAgo(order.ageDays)},
      ${status === "CONFIRMED" ? baseline.atDaysAgo(order.ageDays) : null})
    on conflict (id) do update set status = excluded.status,
      provider_reference = excluded.provider_reference,
      confirmed_at = excluded.confirmed_at
  `;
  if (order.refund) {
    await sql`
      insert into payment_direct_refunds
        (order_id, store_id, payment_attempt_id, amount, provider, status, version,
         reason, evidence_reference, requested_by, requested_at, updated_at)
      values (${id(order.key)}, ${id("store.aban")}, ${attemptId}, ${totalAmount},
        'DEV', ${order.refund}, ${order.refund === "CONFIRMED" ? 2 : 1},
        'لغو سفارش با درخواست فروشنده',
        ${order.refund === "CONFIRMED" ? `demo-refund-${order.key}` : null},
        ${id("identity.seller")}, ${baseline.atDaysAgo(order.ageDays)}, ${baseline.now})
      on conflict (order_id) do update set status = excluded.status,
        version = excluded.version, evidence_reference = excluded.evidence_reference,
        updated_at = excluded.updated_at
    `;
  }
}

async function seedFulfillment(sql, baseline, order) {
  if (!order.fulfillment) return;
  const { id } = baseline.ids;
  const version = {
    ACTION_REQUIRED: 1,
    PREPARING: 2,
    SHIPPED: 3,
    DELIVERED: 4,
    CANCELLATION_PENDING_REFUND: 3,
    CANCELLED: 4,
  }[order.fulfillment];
  const storeId = order.fulfillment === "ACTION_REQUIRED" ? null : id("store.aban");
  await sql`
    insert into fulfillment_orders
      (order_id, store_id, status, version, accepted_event_id, created_at, updated_at)
    values (${id(order.key)}, ${storeId}, ${order.fulfillment}, ${version},
      ${id(`${order.key}.fulfillment-event`)}, ${baseline.atDaysAgo(order.ageDays)},
      ${baseline.now})
    on conflict (order_id) do update set store_id = excluded.store_id,
      status = excluded.status, version = excluded.version, updated_at = excluded.updated_at
  `;
  await sql`
    insert into fulfillment_timeline_entries
      (id, order_id, version, status, actor_type, actor_id, correlation_id,
       occurred_at, shipping_method, tracking_code)
    values (${id(`${order.key}.fulfillment-timeline`)}, ${id(order.key)}, ${version},
      ${order.fulfillment}, ${order.fulfillment === "ACTION_REQUIRED" ? "SYSTEM" : "IDENTITY"},
      ${order.fulfillment === "ACTION_REQUIRED" ? null : id("identity.seller")},
      ${id(`${order.key}.fulfillment-correlation`)}, ${baseline.atDaysAgo(order.ageDays)},
      ${order.fulfillment === "SHIPPED" ? "پست پیشتاز" : null},
      ${order.fulfillment === "SHIPPED" ? "DEMO-TRACK-1405" : null})
    on conflict (id) do nothing
  `;
}

async function rebuildDemoProjections(sql, baseline) {
  const { id } = baseline.ids;
  for (const store of baseline.stores) {
    await sql`
      insert into discovery_store_feed_projections
        (store_id, published, aggregate_version, publication_version, updated_at)
      values (${id(store.key)}, ${store.status === "PUBLISHED"}, 1,
        ${store.status === "PUBLISHED" ? 1 : 0}, ${baseline.now})
      on conflict (store_id) do update set published = excluded.published,
        aggregate_version = 1, publication_version = excluded.publication_version,
        updated_at = excluded.updated_at
    `;
    if (store.status === "PUBLISHED") {
      await sql`
        insert into reporting_store_publications
          (store_id, last_event_id, publication_version, published_at, projected_at)
        values (${id(store.key)}, ${id(`${store.key}.reporting-publication-event`)},
          1, ${baseline.atDaysAgo(30)}, ${baseline.now})
        on conflict (store_id) do update set
          last_event_id = excluded.last_event_id,
          publication_version = excluded.publication_version,
          published_at = excluded.published_at,
          projected_at = excluded.projected_at
      `;
    }
  }
  for (const product of baseline.products.filter(({ state }) => state !== "DRAFT")) {
    const published = product.state === "PUBLISHED";
    await sql`
      insert into discovery_product_feed_projections
        (product_id, store_id, product_aggregate_version, publication_version,
         published, first_published_at, eligible_since, offer_version,
         availability_version, updated_at, publication_updated_at)
      values (${id(product.key)}, ${id(product.store)}, 1, 1, ${published},
        ${baseline.atDaysAgo(20)}, ${baseline.atDaysAgo(20)}, 1, 1,
        ${baseline.now}, ${baseline.atDaysAgo(20)})
      on conflict (product_id) do update set published = excluded.published,
        offer_version = 1, availability_version = 1, updated_at = excluded.updated_at
    `;
  }
  await sql`
    insert into discovery_projection_status
      (projection_name, healthy, reason, updated_at)
    values ('public-feed-v1', true, null, ${baseline.now})
    on conflict (projection_name) do update set healthy = true, reason = null,
      updated_at = excluded.updated_at
  `;
  await sql`
    delete from discovery_follower_count_relation_projections
    where relation_id in (${id("follow.buyer-aban")}, ${id("follow.buyer-paper")})
  `;
  await sql`
    insert into discovery_follower_count_relation_projections
      (relation_id, identity_id, store_id, status, relation_revision, updated_at)
    select relation_id, identity_id, store_id, status, revision, updated_at
    from discovery_store_follows
    where relation_id in (${id("follow.buyer-aban")}, ${id("follow.buyer-paper")})
  `;
  for (const storeKey of ["store.aban", "store.paper"]) {
    await sql`
      insert into discovery_public_follower_counts (store_id, follower_count, updated_at)
      select ${id(storeKey)}, count(*)::integer, ${baseline.now}
      from discovery_follower_count_relation_projections relation
      join discovery_identity_status_projections identity
        on identity.identity_id = relation.identity_id
      where relation.store_id = ${id(storeKey)} and relation.status = 'ACTIVE'
        and identity.status = 'ACTIVE'
      on conflict (store_id) do update set follower_count = excluded.follower_count,
        updated_at = excluded.updated_at
    `;
  }
  for (const order of baseline.orders) {
    const product = baseline.resources.get(order.product);
    const totalAmount = product.price + 850000;
    const paid = !["PENDING_PAYMENT", "PAYMENT_REVIEW", "EXPIRED"].includes(
      order.state,
    );
    if (paid) {
      await sql`
        insert into reporting_seller_order_facts
          (order_id, store_id, total_amount, currency, paid_at, aggregate_version,
           last_event_id, projected_at)
        values (${id(order.key)}, ${id("store.aban")}, ${totalAmount}, 'IRR',
          ${baseline.atDaysAgo(order.ageDays)}, 1,
          ${id(`${order.key}.reporting-order-event`)}, ${baseline.now})
        on conflict (order_id) do update set total_amount = excluded.total_amount,
          paid_at = excluded.paid_at, aggregate_version = 1,
          last_event_id = excluded.last_event_id, projected_at = excluded.projected_at
      `;
    }
    if (
      [
        "PREPARING",
        "SHIPPED",
        "DELIVERED",
        "CANCELLATION_PENDING_REFUND",
        "CANCELLED",
      ].includes(order.fulfillment)
    ) {
      const version = {
        PREPARING: 2,
        SHIPPED: 3,
        DELIVERED: 4,
        CANCELLATION_PENDING_REFUND: 3,
        CANCELLED: 4,
      }[order.fulfillment];
      await sql`
        insert into reporting_fulfillment_states
          (order_id, status, aggregate_version, last_event_id, occurred_at,
           projected_at)
        values (${id(order.key)}, ${order.fulfillment}, ${version},
          ${id(`${order.key}.reporting-fulfillment-event`)},
          ${baseline.atDaysAgo(order.ageDays)}, ${baseline.now})
        on conflict (order_id) do update set status = excluded.status,
          aggregate_version = excluded.aggregate_version,
          last_event_id = excluded.last_event_id, occurred_at = excluded.occurred_at,
          projected_at = excluded.projected_at
      `;
    }
    if (
      ["ACTION_REQUIRED", "PREPARING", "SHIPPED", "DELIVERED"].includes(
        order.fulfillment,
      )
    ) {
      const version = {
        ACTION_REQUIRED: 1,
        PREPARING: 2,
        SHIPPED: 3,
        DELIVERED: 4,
      }[order.fulfillment];
      await sql`
        insert into order_fulfillment_status_projections
          (order_id, status, version, accepted_event_id, updated_at)
        values (${id(order.key)}, ${order.fulfillment}, ${version},
          ${id(`${order.key}.order-fulfillment-event`)}, ${baseline.now})
        on conflict (order_id) do update set status = excluded.status,
          version = excluded.version, accepted_event_id = excluded.accepted_event_id,
          updated_at = excluded.updated_at
      `;
    }
  }
  await sql`
    insert into reporting_seller_dispute_states
      (dispute_id, store_id, order_id, status, deadline_at, aggregate_version,
       last_event_id, occurred_at, projected_at)
    values (${id("dispute.open")}, ${id("store.aban")}, ${id("order.disputed")},
      'UNDER_REVIEW', ${new Date(baseline.now.getTime() + 2 * 86_400_000)}, 2,
      ${id("dispute.open.reporting-event")}, ${baseline.atDaysAgo(1)}, ${baseline.now})
    on conflict (dispute_id) do update set status = excluded.status,
      deadline_at = excluded.deadline_at, aggregate_version = excluded.aggregate_version,
      last_event_id = excluded.last_event_id, occurred_at = excluded.occurred_at,
      projected_at = excluded.projected_at
  `;
}

export { stableDemoId };
