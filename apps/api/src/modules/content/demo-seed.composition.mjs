export async function convergeContentDemoState({
  sql,
  manifest,
  baseline,
  productStates,
}) {
  const { id, storeOwnerId } = baseline.ids;
  const salesContents = manifest.resources.filter(
    ({ kind }) => kind === "salesContent",
  );
  for (const content of salesContents) {
    const product = productStates.get(content.product);
    const publishedAt = baseline.atDaysAgo(content.ageDays);
    await sql`
      with upserted_aggregate as (
        insert into content_sales_contents
        (id, store_id, actor_identity_id, source, moderation_state, media_id,
         media_kind, active, created_at)
        values (${id(content.key)}, ${id(content.store)}, ${storeOwnerId(content.store)},
          'SELLER', 'PUBLISHED', ${id(`${content.key}.media`)}, ${content.mediaKind},
          true, ${publishedAt})
        on conflict (id) do update set moderation_state = 'PUBLISHED', active = true,
          store_id = excluded.store_id, actor_identity_id = excluded.actor_identity_id,
          media_id = excluded.media_id, media_kind = excluded.media_kind
        returning id
      ), upserted_public_store as (
        insert into content_public_store_states
          (store_id, aggregate_version, publication_version, published, updated_at)
        values (${id(content.store)}, 1, 1, true, ${baseline.now})
        on conflict (store_id) do update set published = true,
          aggregate_version = greatest(content_public_store_states.aggregate_version, 1),
          publication_version = greatest(content_public_store_states.publication_version, 1),
          updated_at = greatest(content_public_store_states.updated_at, excluded.updated_at)
        returning store_id
      ), updated_projection_status as (
        update content_public_sales_content_status
        set updated_at = greatest(updated_at, ${baseline.now})
        where projection_name = 'public-sales-content-v2'
        returning projection_name
      )
      insert into content_public_sales_contents
        (content_id, store_id, source, moderation_state, media_id, media_kind,
         aggregate_version, published_at, updated_at)
      values (${id(content.key)}, ${id(content.store)}, 'SELLER', 'PUBLISHED',
        ${id(`${content.key}.media`)}, ${content.mediaKind}, 1, ${publishedAt},
        ${publishedAt})
      on conflict (content_id) do update set store_id = excluded.store_id,
        source = excluded.source, moderation_state = excluded.moderation_state,
        media_id = excluded.media_id, media_kind = excluded.media_kind,
        aggregate_version = excluded.aggregate_version,
        published_at = excluded.published_at, updated_at = excluded.updated_at
    `;
    await sql`
      with retired_aggregate_links as (
        update content_sales_content_products set active = false
        where content_id = ${id(content.key)} and product_id <> ${id(content.product)}
        returning content_id
      ), upserted_aggregate_link as (
        insert into content_sales_content_products
        (content_id, product_id, publication_version, active)
        values (${id(content.key)}, ${id(content.product)}, ${product.publicationVersion}, true)
        on conflict (content_id, product_id) do update set active = true,
          publication_version = excluded.publication_version
        returning content_id
      ), retired_public_links as (
        delete from content_public_sales_content_products
        where content_id = ${id(content.key)} and product_id <> ${id(content.product)}
        returning content_id
      )
      insert into content_public_sales_content_products
        (content_id, product_id, active, last_product_aggregate_version,
         last_product_occurred_at)
      values (${id(content.key)}, ${id(content.product)}, true,
        ${product.revision}, ${baseline.now})
      on conflict (content_id, product_id) do update set active = true,
        last_product_aggregate_version = excluded.last_product_aggregate_version,
        last_product_occurred_at = excluded.last_product_occurred_at
    `;
  }
  for (const product of baseline.products.filter(({ state }) => state !== "DRAFT")) {
    const current = productStates.get(product.key);
    await sql`
      with upserted_aggregate_state as (
        insert into content_product_states
        (product_id, aggregate_version, publication_version, active, updated_at)
        values (${id(product.key)}, ${current.revision}, ${current.publicationVersion},
          ${product.state === "PUBLISHED"}, ${baseline.now})
        on conflict (product_id) do update set active = excluded.active,
          aggregate_version = excluded.aggregate_version,
          publication_version = excluded.publication_version,
          updated_at = excluded.updated_at
        returning product_id
      )
      insert into content_public_product_states
        (product_id, aggregate_version, publication_version, active, updated_at)
      values (${id(product.key)}, ${current.revision}, ${current.publicationVersion},
        ${product.state === "PUBLISHED"}, ${baseline.now})
      on conflict (product_id) do update set active = excluded.active,
        aggregate_version = excluded.aggregate_version,
        publication_version = excluded.publication_version,
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
      await sql`
        with retired_content as (
          update content_sales_contents set active = false where id = ${resource.id}
          returning id
        ), retired_links as (
          update content_sales_content_products set active = false
          where content_id = ${resource.id}
          returning content_id
        )
        delete from content_public_sales_contents where content_id = ${resource.id}
      `;
    }
    if (resource.key.startsWith("experience.")) {
      await sql`update content_purchase_experiences set moderation_state = 'HIDDEN' where id = ${resource.id}`;
    }
    if (resource.key.startsWith("product.")) {
      await sql`
        with retired_product as (
          update content_product_states set active = false
          where product_id = ${resource.id}
          returning product_id
        ), retired_public_product as (
          update content_public_product_states set active = false
          where product_id = ${resource.id}
          returning product_id
        )
        update content_public_sales_content_products set active = false
        where product_id = ${resource.id}
      `;
    }
  }
}
