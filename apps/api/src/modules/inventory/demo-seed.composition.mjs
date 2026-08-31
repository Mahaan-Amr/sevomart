export async function convergeInventoryDemoState({ sql, baseline }) {
  const { id } = baseline.ids;
  const states = new Map();
  for (const product of baseline.products) {
    for (const variant of baseline.variantsFor(product)) {
      const variantId = id(`${product.key}.variant.${variant.key}`);
      const [current] = await sql`
        select on_hand as "onHand", revision, store_id as "storeId" from inventory_levels
        where variant_id = ${variantId}
      `;
      if (
        current?.onHand === (variant.onHand ?? 0) &&
        current?.storeId === id(product.store)
      )
        continue;
      const previousOnHand = current?.onHand ?? 0;
      const previousRevision = current?.revision ?? 0;
      const nextRevision = previousRevision + 1;
      await sql`
        insert into inventory_levels (variant_id, store_id, on_hand, revision, updated_at)
        values (${variantId}, ${id(product.store)}, ${variant.onHand ?? 0},
          ${nextRevision}, ${baseline.now})
        on conflict (variant_id) do update set on_hand = excluded.on_hand,
          store_id = excluded.store_id, revision = excluded.revision,
          updated_at = excluded.updated_at
      `;
      await sql`
        insert into inventory_adjustments
          (id, variant_id, store_id, actor_identity_id, reason_code,
           previous_on_hand, next_on_hand, revision, correlation_id, occurred_at,
           note, operation, previous_revision, next_revision)
        values (${id(`${product.key}.variant.${variant.key}.inventory.${nextRevision}`)},
          ${variantId}, ${id(product.store)}, ${baseline.ids.storeOwnerId(product.store)},
          ${current ? "CORRECTION" : "INITIAL_STOCK"}, ${previousOnHand},
          ${variant.onHand ?? 0}, ${nextRevision},
          ${id(`${product.key}.variant.${variant.key}.inventory-correlation.${nextRevision}`)},
          ${baseline.now}, 'همگرایی داده نمایشی نسخه‌دار', 'REPLACE_ON_HAND',
          ${previousRevision}, ${nextRevision})
        on conflict (id) do nothing
      `;
    }
    const variantIds = baseline
      .variantsFor(product)
      .map((variant) => id(`${product.key}.variant.${variant.key}`));
    const [state] = await sql`
      select coalesce(max(revision), 1)::int as revision from inventory_levels
      where variant_id = any(${variantIds})
    `;
    states.set(product.key, state.revision);
  }
  return states;
}

export async function retireInventoryDemoState({ sql, targets, id, now }) {
  for (const target of targets) {
    const rows = await sql`
      select variant_id as "variantId", store_id as "storeId", on_hand as "onHand", revision
      from inventory_levels where variant_id = ${target.variantId}
    `;
    for (const row of rows) {
      if (row.onHand === 0) continue;
      const nextRevision = row.revision + 1;
      await sql`
        update inventory_levels set on_hand = 0, revision = ${nextRevision}, updated_at = ${now}
        where variant_id = ${row.variantId}
      `;
      await sql`
        insert into inventory_adjustments
          (id, variant_id, store_id, actor_identity_id, reason_code,
           previous_on_hand, next_on_hand, revision, correlation_id, occurred_at,
           note, operation, previous_revision, next_revision)
        values (${id(`${target.resourceKey}.${row.variantId}.retired-inventory.${nextRevision}`)},
          ${row.variantId}, ${row.storeId}, ${id("identity.seller")}, 'CORRECTION',
          ${row.onHand}, 0, ${nextRevision},
          ${id(`${target.resourceKey}.${row.variantId}.retired-inventory-correlation.${nextRevision}`)},
          ${now}, 'بازنشستگی منبع داده نمایشی', 'REPLACE_ON_HAND',
          ${row.revision}, ${nextRevision})
        on conflict (id) do nothing
      `;
    }
  }
}
