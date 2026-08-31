export async function convergeDiscoveryDemoState({
  sql,
  manifest,
  baseline,
  productStates,
  storeStates,
  inventoryStates,
}) {
  const { id } = baseline.ids;
  const follows = manifest.resources.filter(({ kind }) => kind === "follow");
  const followRevisions = new Map();
  let followSetChanged = false;
  for (const follow of follows) {
    const [previous] = await sql`
      select identity_id as "identityId", store_id as "storeId", status,
        deactivated_at as "deactivatedAt"
      from discovery_store_follows where relation_id = ${id(follow.key)}
    `;
    followSetChanged ||=
      !previous ||
      previous.identityId !== id(follow.identity) ||
      previous.storeId !== id(follow.store) ||
      previous.status !== "ACTIVE" ||
      previous.deactivatedAt !== null;
    const [current] = await sql`
      insert into discovery_store_follows
        (relation_id, identity_id, store_id, status, revision, activated_at,
         deactivated_at, updated_at)
      values (${id(follow.key)}, ${id(follow.identity)}, ${id(follow.store)},
        'ACTIVE', 1, ${baseline.atDaysAgo(15)}, null, ${baseline.atDaysAgo(15)})
      on conflict (relation_id) do update set identity_id = excluded.identity_id,
        store_id = excluded.store_id, status = 'ACTIVE',
        revision = discovery_store_follows.revision + case when
          discovery_store_follows.status <> 'ACTIVE'
          or discovery_store_follows.deactivated_at is not null
          or discovery_store_follows.identity_id <> excluded.identity_id
          or discovery_store_follows.store_id <> excluded.store_id
        then 1 else 0 end, deactivated_at = null,
        updated_at = excluded.updated_at
      returning revision
    `;
    followRevisions.set(follow.key, current.revision);
  }
  await sql`
    insert into discovery_follow_sets (identity_id, revision, updated_at)
    values (${id("identity.buyer")}, ${Math.max(follows.length, 1)}, ${baseline.now})
    on conflict (identity_id) do update set revision = case
      when ${followSetChanged} then discovery_follow_sets.revision + 1
      else discovery_follow_sets.revision end,
      updated_at = excluded.updated_at
  `;
  await sql`
    insert into discovery_identity_status_projections
      (identity_id, status, status_version, updated_at)
    values (${id("identity.buyer")}, 'ACTIVE', 1, ${baseline.now})
    on conflict (identity_id) do update set status = 'ACTIVE', updated_at = excluded.updated_at
  `;
  for (const store of baseline.stores) {
    const current = storeStates.get(store.key);
    await sql`
      insert into discovery_store_feed_projections
        (store_id, published, aggregate_version, publication_version, updated_at)
      values (${id(store.key)}, ${store.status === "PUBLISHED"}, ${current.revision},
        ${current.publicationVersion}, ${baseline.now})
      on conflict (store_id) do update set published = excluded.published,
        aggregate_version = excluded.aggregate_version,
        publication_version = excluded.publication_version, updated_at = excluded.updated_at
    `;
  }
  for (const product of baseline.products.filter(({ state }) => state !== "DRAFT")) {
    const current = productStates.get(product.key);
    await sql`
      insert into discovery_product_feed_projections
        (product_id, store_id, product_aggregate_version, publication_version,
         published, first_published_at, eligible_since, offer_version,
         availability_version, updated_at, publication_updated_at)
      values (${id(product.key)}, ${id(product.store)}, ${current.revision},
        ${current.publicationVersion},
        ${product.state === "PUBLISHED"}, ${baseline.atDaysAgo(20)},
        ${baseline.atDaysAgo(20)}, ${current.offerVersion},
        ${inventoryStates.get(product.key)}, ${baseline.now}, ${baseline.atDaysAgo(20)})
      on conflict (product_id) do update set published = excluded.published,
        product_aggregate_version = excluded.product_aggregate_version,
        publication_version = excluded.publication_version,
        offer_version = excluded.offer_version,
        availability_version = excluded.availability_version,
        updated_at = excluded.updated_at
    `;
  }
  await sql`
    insert into discovery_projection_status (projection_name, healthy, reason, updated_at)
    values ('public-feed-v1', true, null, ${baseline.now})
    on conflict (projection_name) do update set healthy = true, reason = null,
      updated_at = excluded.updated_at
  `;
  await sql`
    delete from discovery_follower_count_relation_projections
    where relation_id = any(${follows.map((follow) => id(follow.key))})
  `;
  for (const follow of follows) {
    await sql`
      insert into discovery_follower_count_relation_projections
        (relation_id, identity_id, store_id, status, relation_revision, updated_at)
      values (${id(follow.key)}, ${id(follow.identity)}, ${id(follow.store)},
        'ACTIVE', ${followRevisions.get(follow.key)}, ${baseline.now})
      on conflict (relation_id) do update set status = 'ACTIVE',
        identity_id = excluded.identity_id, store_id = excluded.store_id,
        relation_revision = excluded.relation_revision, updated_at = excluded.updated_at
    `;
  }
  for (const store of baseline.stores) {
    const count = follows.filter((follow) => follow.store === store.key).length;
    await sql`
      insert into discovery_public_follower_counts (store_id, follower_count, updated_at)
      values (${id(store.key)}, ${count}, ${baseline.now})
      on conflict (store_id) do update set follower_count = excluded.follower_count,
        updated_at = excluded.updated_at
    `;
  }
}

export async function retireDiscoveryDemoState({ sql, retired, now }) {
  for (const resource of retired) {
    if (resource.key.startsWith("follow.")) {
      const [follow] = await sql`
        select store_id as "storeId", identity_id as "identityId"
        from discovery_store_follows
        where relation_id = ${resource.id}
      `;
      await sql`
        update discovery_store_follows set status = 'INACTIVE',
          revision = revision + 1, deactivated_at = ${now}, updated_at = ${now}
        where relation_id = ${resource.id}
      `;
      await sql`delete from discovery_follower_count_relation_projections where relation_id = ${resource.id}`;
      if (follow) {
        await sql`
          update discovery_follow_sets set revision = revision + 1, updated_at = ${now}
          where identity_id = ${follow.identityId}
        `;
        await sql`
          update discovery_public_follower_counts set follower_count = (
            select count(*)::integer from discovery_follower_count_relation_projections
            where store_id = ${follow.storeId} and status = 'ACTIVE'
          ), updated_at = ${now} where store_id = ${follow.storeId}
        `;
      }
    }
    if (resource.key.startsWith("store.")) {
      await sql`update discovery_store_feed_projections set published = false, updated_at = ${now} where store_id = ${resource.id}`;
    }
    if (resource.key.startsWith("product.")) {
      await sql`update discovery_product_feed_projections set published = false, updated_at = ${now} where product_id = ${resource.id}`;
    }
  }
}
