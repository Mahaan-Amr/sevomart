export async function convergePaymentsDemoState({ sql, baseline }) {
  const { id } = baseline.ids;
  for (const order of baseline.orders) {
    if (["PENDING_PAYMENT", "EXPIRED"].includes(order.state)) continue;
    const product = baseline.resources.get(order.product);
    const totalAmount = product.price + 850000;
    const status = order.payment ?? "CONFIRMED";
    const attemptId = id(`${order.key}.payment`);
    const createdAt = baseline.atDaysAgo(order.ageDays, order.ageMinutes ?? 0);
    const scenario = status === "REVIEW_REQUIRED" ? "pending" : "success";
    await sql`
      insert into payment_attempts
        (id, order_id, identity_id, status, amount, currency, provider,
         provider_reference, redirect_url, created_at, dispatched_at, confirmed_at)
      values (${attemptId}, ${id(order.key)}, ${id("identity.buyer")}, ${status},
        ${totalAmount}, 'IRR', 'DEV', ${`dev-scenario-${scenario}-${attemptId}`},
        ${`/v1/payment-providers/dev/pay/${attemptId}?scenario=${scenario}`},
        ${createdAt}, ${new Date(createdAt.getTime() + 60_000)},
        ${status === "CONFIRMED" ? new Date(createdAt.getTime() + 2 * 60_000) : null})
      on conflict (id) do update set status = excluded.status,
        provider_reference = excluded.provider_reference, redirect_url = excluded.redirect_url,
        confirmed_at = excluded.confirmed_at
    `;
    await seedAttemptAudit(sql, baseline, order, attemptId, status, createdAt);
    if (order.refund) await seedRefund(sql, baseline, order, attemptId, totalAmount);
  }
}

async function seedAttemptAudit(sql, baseline, order, attemptId, status, createdAt) {
  const { id } = baseline.ids;
  const states = [
    { from: null, to: "CREATED", reason: "ATTEMPT_CREATED" },
    { from: "CREATED", to: "DISPATCHED", reason: "PROVIDER_DISPATCHED" },
    ...(status === "CONFIRMED"
      ? [{ from: "DISPATCHED", to: "CONFIRMED", reason: "PROVIDER_CONFIRMED" }]
      : [{ from: "DISPATCHED", to: "REVIEW_REQUIRED", reason: "PROVIDER_PENDING" }]),
  ];
  for (const [index, state] of states.entries()) {
    await sql`
      insert into payment_attempt_audits
        (id, attempt_id, from_status, to_status, reason_code, actor_kind,
         correlation_id, occurred_at)
      values (${id(`${order.key}.payment-audit.${index + 1}`)}, ${attemptId},
        ${state.from}, ${state.to}, ${state.reason},
        ${index < 2 ? "SYSTEM" : "PROVIDER"},
        ${id(`${order.key}.payment-correlation.${index + 1}`)},
        ${new Date(createdAt.getTime() + index * 60_000)})
      on conflict (id) do nothing
    `;
  }
}

async function seedRefund(sql, baseline, order, attemptId, totalAmount) {
  const { id } = baseline.ids;
  const createdAt = baseline.atDaysAgo(order.ageDays, order.ageMinutes ?? 0);
  await sql`
    insert into payment_direct_refunds
      (order_id, store_id, payment_attempt_id, amount, provider, status, version,
       reason, evidence_reference, requested_by, requested_at, updated_at)
    values (${id(order.key)}, ${id("store.aban")}, ${attemptId}, ${totalAmount},
      'DEV', ${order.refund}, ${order.refund === "CONFIRMED" ? 2 : 1},
      'لغو سفارش با درخواست فروشنده',
      ${order.refund === "CONFIRMED" ? `demo-refund-${order.key}` : null},
      ${id("identity.seller")}, ${createdAt}, ${baseline.now})
    on conflict (order_id) do update set status = excluded.status,
      version = excluded.version, evidence_reference = excluded.evidence_reference,
      updated_at = excluded.updated_at
  `;
  await sql`
    insert into payment_direct_refund_audits
      (id, order_id, version, from_status, to_status, evidence_reference,
       actor_kind, actor_reference, provider, provider_event_id, request_hash,
       correlation_id, occurred_at)
    values (${id(`${order.key}.refund-audit.1`)}, ${id(order.key)}, 1, null, 'PENDING',
      null, 'SELLER', ${id("identity.seller")}, null, null,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ${id(`${order.key}.refund-correlation.1`)}, ${createdAt})
    on conflict (order_id, version) do nothing
  `;
  if (order.refund === "CONFIRMED") {
    await sql`
      insert into payment_direct_refund_audits
        (id, order_id, version, from_status, to_status, evidence_reference,
         actor_kind, actor_reference, provider, provider_event_id, request_hash,
         correlation_id, occurred_at)
      values (${id(`${order.key}.refund-audit.2`)}, ${id(order.key)}, 2, 'PENDING',
        'CONFIRMED', ${`demo-refund-${order.key}`}, 'PROVIDER', 'DEV', 'DEV',
        ${`demo-refund-event-${order.key}`}, null,
        ${id(`${order.key}.refund-correlation.2`)},
        ${new Date(createdAt.getTime() + 86_400_000)})
      on conflict (order_id, version) do nothing
    `;
  }
}

export async function retirePaymentsDemoState({ sql, retired, id, now }) {
  for (const resource of retired.filter(({ key }) => key.startsWith("order."))) {
    const [attempt] = await sql`
      select id, status from payment_attempts where order_id = ${resource.id}
    `;
    if (
      attempt &&
      ["CREATED", "DISPATCHED", "REVIEW_REQUIRED"].includes(attempt.status)
    ) {
      await sql`update payment_attempts set status = 'FAILED' where id = ${attempt.id}`;
      await sql`
        insert into payment_attempt_audits
          (id, attempt_id, from_status, to_status, reason_code, actor_kind,
           correlation_id, occurred_at)
        values (${id(`${resource.key}.retirement-payment-audit`)}, ${attempt.id},
          ${attempt.status}, 'FAILED', 'DEMO_RESOURCE_RETIRED', 'SYSTEM',
          ${id(`${resource.key}.retirement-payment-correlation`)}, ${now})
        on conflict (id) do nothing
      `;
    }
  }
}
