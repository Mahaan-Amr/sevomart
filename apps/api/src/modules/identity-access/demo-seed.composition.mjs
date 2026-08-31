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
  if (application) {
    const [current] = await sql`
      select application.status, application.current_revision as "currentRevision",
        application.aggregate_version as "aggregateVersion",
        revision.applicant_name as "applicantName",
        revision.proposed_store_name as "storeName",
        revision.goods_area_text as "goodsArea",
        revision.current_sales_method as "salesMethod"
      from identity_seller_applications application
      left join identity_seller_application_revisions revision
        on revision.application_id = application.id
        and revision.revision = application.current_revision
      where application.id = ${id(application.key)}
    `;
    const changed =
      !current ||
      current.status !== "SUBMITTED" ||
      current.applicantName !== application.applicantName ||
      current.storeName !== application.storeName ||
      current.goodsArea !== application.goodsArea ||
      current.salesMethod !== application.salesMethod;
    const revision = current ? current.currentRevision + (changed ? 1 : 0) : 1;
    const aggregateVersion = current ? current.aggregateVersion + (changed ? 1 : 0) : 1;
    await sql`
      insert into identity_seller_applications
        (id, identity_id, status, current_revision, aggregate_version, created_at,
         last_submitted_at)
      values (${id(application.key)}, ${id(application.identity)}, 'SUBMITTED',
        ${revision}, ${aggregateVersion}, ${baseline.atDaysAgo(3)},
        ${baseline.atDaysAgo(3)})
      on conflict (id) do update set identity_id = excluded.identity_id,
        status = 'SUBMITTED', current_revision = excluded.current_revision,
        aggregate_version = excluded.aggregate_version,
        last_submitted_at = excluded.last_submitted_at, completed_at = null
    `;
    await sql`
      insert into identity_seller_application_revisions
        (id, application_id, revision, applicant_name, proposed_store_name,
         goods_area_text, current_sales_method, submitted_at)
      values (${id(`${application.key}.revision.${revision}`)}, ${id(application.key)},
        ${revision}, ${application.applicantName}, ${application.storeName},
        ${application.goodsArea}, ${application.salesMethod}, ${baseline.atDaysAgo(3)})
      on conflict (application_id, revision) do nothing
    `;
  }

  for (const grant of manifest.resources.filter(
    ({ kind }) => kind === "platformGrant",
  )) {
    const existing = await sql`
      select id, permission from identity_platform_permission_grants
      where identity_id = ${id(grant.identity)} and revoked_at is null
    `;
    const desiredPermissions = new Set(grant.permissions);
    const obsoleteIds = existing
      .filter(
        ({ id: grantId, permission }) =>
          grantId === id(`${grant.key}.${permission.toLowerCase()}`) &&
          !desiredPermissions.has(permission),
      )
      .map(({ id: grantId }) => grantId);
    if (obsoleteIds.length > 0) {
      await sql`
        update identity_platform_permission_grants set revoked_at = ${baseline.now}
        where id = any(${obsoleteIds})
      `;
    }
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
