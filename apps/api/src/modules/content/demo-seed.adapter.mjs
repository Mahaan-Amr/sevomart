export async function convergeContentDemoState({ sql, manifest, baseline }) {
  const { id, storeOwnerId } = baseline.ids;
  for (const content of manifest.resources.filter(
    ({ kind }) => kind === "salesContent",
  )) {
    await sql`
      insert into content_sales_contents
        (id, store_id, actor_identity_id, source, moderation_state, media_id,
         media_kind, active, created_at)
      values (${id(content.key)}, ${id(content.store)}, ${storeOwnerId(content.store)},
        'SELLER', 'PUBLISHED', ${id(`${content.key}.media`)}, ${content.mediaKind},
        true, ${baseline.atDaysAgo(content.ageDays)})
      on conflict (id) do update set moderation_state = 'PUBLISHED', active = true,
        media_id = excluded.media_id, media_kind = excluded.media_kind
    `;
    await sql`
      insert into content_sales_content_products
        (content_id, product_id, publication_version, active)
      values (${id(content.key)}, ${id(content.product)}, 1, true)
      on conflict (content_id, product_id) do update set active = true
    `;
  }
  for (const product of baseline.products.filter(({ state }) => state !== "DRAFT")) {
    await sql`
      insert into content_product_states
        (product_id, aggregate_version, publication_version, active, updated_at)
      values (${id(product.key)}, 1, 1, ${product.state === "PUBLISHED"}, ${baseline.now})
      on conflict (product_id) do update set active = excluded.active,
        updated_at = excluded.updated_at
    `;
  }

  const experience = manifest.resources.find(
    ({ kind }) => kind === "purchaseExperience",
  );
  if (experience) {
    await sql`
      insert into content_purchase_experiences
        (id, buyer_identity_id, order_item_id, store_id, product_id, source,
         moderation_state, rating, text, media_ids, created_at)
      values (${id(experience.key)}, ${id("identity.buyer")},
        ${id(`${experience.order}.item`)}, ${id("store.aban")}, ${id(experience.product)},
        'VERIFIED_PURCHASE', 'PUBLISHED', ${experience.rating}, ${experience.text},
        '{}', ${baseline.atDaysAgo(14)})
      on conflict (id) do update set rating = excluded.rating, text = excluded.text,
        moderation_state = 'PUBLISHED'
    `;
  }
}

export async function retireContentDemoState({ sql, retired }) {
  for (const resource of retired) {
    if (resource.key.startsWith("content.")) {
      await sql`update content_sales_contents set active = false where id = ${resource.id}`;
      await sql`update content_sales_content_products set active = false where content_id = ${resource.id}`;
    }
    if (resource.key.startsWith("experience.")) {
      await sql`update content_purchase_experiences set moderation_state = 'HIDDEN' where id = ${resource.id}`;
    }
    if (resource.key.startsWith("product.")) {
      await sql`update content_product_states set active = false where product_id = ${resource.id}`;
    }
  }
}
