export async function convergeStoreDemoState({ sql, baseline }) {
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

export async function retireStoreDemoState({ sql, retired, now }) {
  for (const resource of retired.filter(({ key }) => key.startsWith("store."))) {
    await sql`
      update store_stores set status = 'UNPUBLISHED', publication_version = 0,
        published_at = null, updated_at = ${now}
      where id = ${resource.id}
    `;
    await sql`update store_shipping_methods set enabled = false where store_id = ${resource.id}`;
  }
}
