export async function convergeReportingDemoState({
  sql,
  baseline,
  fulfillmentStates,
  storeStates,
}) {
  const { id } = baseline.ids;
  for (const store of baseline.stores.filter(({ status }) => status === "PUBLISHED")) {
    const current = storeStates.get(store.key);
    await sql`
      insert into reporting_store_publications
        (store_id, last_event_id, publication_version, published_at, projected_at)
      values (${id(store.key)}, ${id(`${store.key}.reporting-publication-event`)},
        ${current.publicationVersion}, ${baseline.atDaysAgo(30)}, ${baseline.now})
      on conflict (store_id) do update set publication_version = excluded.publication_version,
        projected_at = excluded.projected_at
    `;
  }
  for (const order of baseline.orders) {
    if (!["PENDING_PAYMENT", "PAYMENT_REVIEW", "EXPIRED"].includes(order.state)) {
      const totalAmount = baseline.resources.get(order.product).price + 850000;
      await sql`
        insert into reporting_seller_order_facts
          (order_id, store_id, total_amount, currency, paid_at, aggregate_version,
           last_event_id, projected_at)
        values (${id(order.key)}, ${id("store.aban")}, ${totalAmount}, 'IRR',
          ${baseline.atDaysAgo(order.ageDays, order.ageMinutes ?? 0)}, 1,
          ${id(`${order.key}.reporting-order-event`)}, ${baseline.now})
        on conflict (order_id) do update set total_amount = excluded.total_amount,
          projected_at = excluded.projected_at
      `;
    }
    const fulfillment = fulfillmentStates.find(
      ({ orderKey }) => orderKey === order.key,
    );
    if (fulfillment && fulfillment.status !== "ACTION_REQUIRED") {
      await sql`
        insert into reporting_fulfillment_states
          (order_id, status, aggregate_version, last_event_id, occurred_at, projected_at)
        values (${id(order.key)}, ${fulfillment.status}, ${fulfillment.version},
          ${id(`${order.key}.reporting-fulfillment-event`)},
          ${baseline.atDaysAgo(order.ageDays, order.ageMinutes ?? 0)}, ${baseline.now})
        on conflict (order_id) do update set status = excluded.status,
          aggregate_version = excluded.aggregate_version, projected_at = excluded.projected_at
      `;
    }
  }
  const dispute = baseline.resources.get("dispute.open");
  if (dispute)
    await sql`
    insert into reporting_seller_dispute_states
      (dispute_id, store_id, order_id, status, deadline_at, aggregate_version,
       last_event_id, occurred_at, projected_at)
    values (${id("dispute.open")}, ${id("store.aban")}, ${id("order.disputed")},
      'UNDER_REVIEW', ${new Date(baseline.now.getTime() + 2 * 86_400_000)}, 2,
      ${id("dispute.open.reporting-event")}, ${baseline.atDaysAgo(1)}, ${baseline.now})
    on conflict (dispute_id) do update set status = excluded.status,
      deadline_at = excluded.deadline_at, projected_at = excluded.projected_at
  `;
}

export async function retireReportingDemoState({ sql, retired }) {
  for (const resource of retired) {
    if (resource.key.startsWith("store."))
      await sql`delete from reporting_store_publications where store_id = ${resource.id}`;
    if (resource.key.startsWith("order.")) {
      await sql`delete from reporting_fulfillment_states where order_id = ${resource.id}`;
      await sql`delete from reporting_seller_order_facts where order_id = ${resource.id}`;
    }
    if (resource.key.startsWith("dispute."))
      await sql`delete from reporting_seller_dispute_states where dispute_id = ${resource.id}`;
  }
}
