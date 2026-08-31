export async function convergeIdentityAccessDemoState({ sql, manifest, baseline }) {
  const { id } = baseline.ids;
  const identities = manifest.resources.filter(({ kind }) => kind === "loginIdentity");
  for (const store of baseline.stores) {
    if (typeof store.owner !== "string") {
      identities.push({ key: store.owner.key, name: store.owner.name });
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

  for (const sellerKey of new Set(baseline.stores.map(baseline.ownerKey))) {
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
      await sql`
        insert into identity_platform_permission_grants
          (id, identity_id, permission, granted_at, revoked_at)
        values (${id(`${grant.key}.${permission.toLowerCase()}`)},
          ${id(grant.identity)}, ${permission}, ${baseline.atDaysAgo(30)}, null)
        on conflict (id) do update set revoked_at = null
      `;
    }
  }
}

export async function retireIdentityAccessDemoState({ sql, retired, id, now }) {
  for (const resource of retired) {
    if (resource.key.startsWith("platform-grant.")) {
      await sql`
        update identity_platform_permission_grants set revoked_at = ${now}
        where identity_id = ${id(resource.key.replace("platform-grant.", "identity."))}
          and revoked_at is null
      `;
    }
    if (resource.key.startsWith("seller-application.")) {
      await sql`
        update identity_seller_applications
        set status = 'WITHDRAWN', completed_at = ${now}, aggregate_version = aggregate_version + 1
        where id = ${resource.id}
      `;
    }
    if (resource.key.startsWith("identity.")) {
      await sql`update identity_identities set status = 'INACTIVE' where id = ${resource.id}`;
    }
  }
}
