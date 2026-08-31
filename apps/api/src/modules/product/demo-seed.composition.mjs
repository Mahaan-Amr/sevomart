import { isDeepStrictEqual } from "node:util";

export async function convergeProductDemoState({ sql, baseline }) {
  const { id } = baseline.ids;
  const states = new Map();
  const retiredVariants = [];
  for (const product of baseline.products) {
    const publishedBefore = product.state !== "DRAFT";
    const [current] = await sql`
      select product.revision, product.publication_version as "publicationVersion",
        product.state, product.store_id as "storeId", working.name,
        working.description, working.definition
      from product_products product
      left join product_working_copies working on working.product_id = product.id
      where product.id = ${id(product.key)}
    `;
    const variants = baseline.variantsFor(product);
    const description = `نمونه نمایشی ${product.name}`;
    const hasNamedVariants = Array.isArray(product.variants);
    const axis = hasNamedVariants
      ? {
          clientKey: "option",
          name: "گزینه",
          values: variants.map((variant) => ({
            clientKey: variant.key,
            name: variant.label,
          })),
        }
      : undefined;
    const definition = {
      name: product.name,
      description,
      orderedMediaIds: [id(`${product.key}.media`)],
      axes: axis ? [axis] : [],
      variants: variants.map((variant) => ({
        clientKey: variant.key,
        variantId: id(`${product.key}.variant.${variant.key}`),
        combination: axis
          ? [{ axisClientKey: axis.clientKey, valueClientKey: variant.key }]
          : [],
      })),
    };
    const variantStructureChanged = !isDeepStrictEqual(
      current?.definition ?? null,
      definition,
    );
    const publicationChanged =
      !current ||
      current.state !== product.state ||
      current.storeId !== id(product.store) ||
      current.name !== product.name ||
      current.description !== description ||
      variantStructureChanged;
    const revision = current ? current.revision + (publicationChanged ? 1 : 0) : 1;
    const publicationVersion = publishedBefore
      ? current && publicationChanged
        ? current.publicationVersion + 1
        : (current?.publicationVersion ?? 1)
      : (current?.publicationVersion ?? 0);
    const desiredVariantIds = new Set(
      variants.map((variant) => id(`${product.key}.variant.${variant.key}`)),
    );
    const existingVariants = await sql`
      select id, client_key as "clientKey" from product_variants
      where product_id = ${id(product.key)}
    `;
    const obsoleteVariantIds = existingVariants
      .filter(
        ({ id: variantId, clientKey }) =>
          variantId === id(`${product.key}.variant.${clientKey}`) &&
          !desiredVariantIds.has(variantId),
      )
      .map(({ id: variantId }) => variantId);
    if (obsoleteVariantIds.length > 0) {
      await sql`update product_variants set retired = true where id = any(${obsoleteVariantIds})`;
      retiredVariants.push(
        ...obsoleteVariantIds.map((variantId) => ({
          variantId,
          storeId: id(product.store),
          resourceKey: product.key,
        })),
      );
    }
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at,
         created_at, updated_at)
      values (${id(product.key)}, ${id(product.store)}, ${product.state}, ${revision},
        ${publicationVersion}, ${publishedBefore ? baseline.atDaysAgo(20) : null},
        ${baseline.atDaysAgo(25)}, ${baseline.now})
      on conflict (id) do update set state = excluded.state, revision = excluded.revision,
        store_id = excluded.store_id,
        publication_version = excluded.publication_version,
        published_at = excluded.published_at, updated_at = excluded.updated_at
    `;
    await sql`
      insert into product_working_copies
        (product_id, name, description, media_id, variant_id, definition)
      values (${id(product.key)}, ${product.name}, ${description},
        ${id(`${product.key}.media`)}, null, ${sql.json(definition)})
      on conflict (product_id) do update set name = excluded.name,
        description = excluded.description, media_id = excluded.media_id,
        definition = excluded.definition
    `;
    if (publishedBefore && publicationChanged) {
      const publicVariants = variants.map((variant) => ({
        variantId: id(`${product.key}.variant.${variant.key}`),
        combination: axis ? [{ axis: axis.name, value: variant.label }] : [],
        price: { amount: product.price, currency: "IRR" },
        availability: variant.onHand > 0 ? "AVAILABLE" : "OUT_OF_STOCK",
      }));
      const publicSnapshot = {
        productId: id(product.key),
        name: product.name,
        description,
        images: [
          {
            id: id(`${product.key}.media`),
            url: `/v1/media/${id(`${product.key}.media`)}`,
          },
        ],
        axes: axis
          ? [{ name: axis.name, values: variants.map((variant) => variant.label) }]
          : [],
        variants: publicVariants,
        priceRange: {
          minimum: { amount: product.price, currency: "IRR" },
          maximum: { amount: product.price, currency: "IRR" },
        },
        availability: publicVariants.some(
          (variant) => variant.availability === "AVAILABLE",
        )
          ? "AVAILABLE"
          : "OUT_OF_STOCK",
        publicationVersion,
      };
      await sql`
        insert into product_publications
          (product_id, publication_version, name, description, media_id, variant_id,
           snapshot, created_at)
        values (${id(product.key)}, ${publicationVersion}, ${product.name},
          ${description}, ${id(`${product.key}.media`)},
          ${id(`${product.key}.variant.${variants[0].key}`)},
          ${sql.json(publicSnapshot)},
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
          store_id = excluded.store_id,
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
    const [offer] = await sql`
      select coalesce(max(revision), 1)::int as revision
      from product_offers where product_id = ${id(product.key)}
    `;
    states.set(product.key, {
      revision,
      publicationVersion,
      state: product.state,
      offerVersion: offer.revision,
    });
  }
  return { states, retiredVariants };
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
