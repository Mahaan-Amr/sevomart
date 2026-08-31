export async function convergeProductDemoState({ sql, baseline }) {
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
        on conflict (product_id, publication_version) do nothing
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
          ever_published = product_variants.ever_published or excluded.ever_published
      `;
      await sql`
        insert into product_offers
          (product_id, variant_id, amount, currency, revision, sku)
        values (${id(product.key)}, ${variantId}, ${product.price}, 'IRR', 1,
          ${`DEMO-${product.key.split(".").at(-1)}-${variant.key}`})
        on conflict (variant_id) do update set amount = excluded.amount,
          revision = product_offers.revision + 1, sku = excluded.sku
        where product_offers.amount <> excluded.amount or product_offers.sku <> excluded.sku
      `;
    }
  }
}

export async function retireProductDemoState({ sql, retired, now }) {
  const inventoryTargets = [];
  for (const resource of retired.filter(({ key }) => key.startsWith("product."))) {
    const variants = await sql`
      select id as "variantId", store_id as "storeId"
      from product_variants where product_id = ${resource.id}
    `;
    inventoryTargets.push(
      ...variants.map((variant) => ({ ...variant, resourceKey: resource.key })),
    );
    await sql`
      update product_products
      set state = 'UNPUBLISHED', publication_version = publication_version + 1,
        revision = revision + 1, updated_at = ${now}
      where id = ${resource.id} and state <> 'UNPUBLISHED'
    `;
    await sql`update product_variants set retired = true where product_id = ${resource.id}`;
  }
  return inventoryTargets;
}
