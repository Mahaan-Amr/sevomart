const PATHS = {
  ACTION_REQUIRED: ["ACTION_REQUIRED"],
  PREPARING: ["ACTION_REQUIRED", "PREPARING"],
  SHIPPED: ["ACTION_REQUIRED", "PREPARING", "SHIPPED"],
  DELIVERED: ["ACTION_REQUIRED", "PREPARING", "SHIPPED", "DELIVERED"],
  CANCELLATION_PENDING_REFUND: [
    "ACTION_REQUIRED",
    "PREPARING",
    "CANCELLATION_PENDING_REFUND",
  ],
  CANCELLED: [
    "ACTION_REQUIRED",
    "PREPARING",
    "CANCELLATION_PENDING_REFUND",
    "CANCELLED",
  ],
};

export async function convergeFulfillmentDemoState({ sql, baseline }) {
  const { id } = baseline.ids;
  const projectionStates = [];
  for (const order of baseline.orders.filter(({ fulfillment }) => fulfillment)) {
    const path = PATHS[order.fulfillment];
    const createdAt = baseline.atDaysAgo(order.ageDays, order.ageMinutes ?? 0);
    const [existing] = await sql`
      select status, version from fulfillment_orders where order_id = ${id(order.key)}
    `;
    if (existing && existing.status !== order.fulfillment) {
      const nextVersion = existing.version + 1;
      await sql`
        update fulfillment_orders set status = ${order.fulfillment},
          version = ${nextVersion},
          store_id = ${order.fulfillment === "ACTION_REQUIRED" ? null : id("store.aban")},
          updated_at = ${baseline.now}
        where order_id = ${id(order.key)}
      `;
      await insertTimeline(
        sql,
        baseline,
        order,
        order.fulfillment,
        nextVersion,
        baseline.now,
      );
      projectionStates.push({
        orderKey: order.key,
        status: order.fulfillment,
        version: nextVersion,
      });
      continue;
    }
    await sql`
      insert into fulfillment_orders
        (order_id, store_id, status, version, accepted_event_id, created_at, updated_at)
      values (${id(order.key)}, ${order.fulfillment === "ACTION_REQUIRED" ? null : id("store.aban")},
        ${order.fulfillment}, ${path.length}, ${id(`${order.key}.fulfillment-event`)},
        ${createdAt}, ${baseline.now})
      on conflict (order_id) do update set store_id = excluded.store_id,
        status = excluded.status, updated_at = excluded.updated_at
    `;
    for (const [index, status] of path.entries()) {
      await insertTimeline(
        sql,
        baseline,
        order,
        status,
        index + 1,
        new Date(createdAt.getTime() + index * 60 * 60_000),
      );
    }
    projectionStates.push({
      orderKey: order.key,
      status: order.fulfillment,
      version: existing?.version ?? path.length,
    });
  }
  return projectionStates;
}

async function insertTimeline(sql, baseline, order, status, version, occurredAt) {
  const { id } = baseline.ids;
  const shipped = status === "SHIPPED";
  await sql`
    insert into fulfillment_timeline_entries
      (id, order_id, version, status, actor_type, actor_id, correlation_id,
       occurred_at, shipping_method, tracking_code)
    values (${id(`${order.key}.fulfillment-timeline.${version}`)}, ${id(order.key)},
      ${version}, ${status}, ${status === "ACTION_REQUIRED" ? "SYSTEM" : "IDENTITY"},
      ${status === "ACTION_REQUIRED" ? null : id("identity.seller")},
      ${id(`${order.key}.fulfillment-correlation.${version}`)}, ${occurredAt},
      ${shipped ? "پست پیشتاز" : null}, ${shipped ? `DEMO-${order.key}` : null})
    on conflict (id) do nothing
  `;
}

export async function retireFulfillmentDemoState({ sql, retired, id, now }) {
  for (const resource of retired.filter(({ key }) => key.startsWith("order."))) {
    const [fulfillment] = await sql`
      select status, version from fulfillment_orders where order_id = ${resource.id}
    `;
    if (!fulfillment || fulfillment.status === "CANCELLED") continue;
    const nextVersion = fulfillment.version + 1;
    await sql`
      update fulfillment_orders set status = 'CANCELLED', version = ${nextVersion},
        store_id = coalesce(store_id, ${id("store.aban")}), updated_at = ${now}
      where order_id = ${resource.id}
    `;
    await sql`
      insert into fulfillment_timeline_entries
        (id, order_id, version, status, actor_type, actor_id, correlation_id,
         occurred_at, shipping_method, tracking_code)
      values (${id(`${resource.key}.fulfillment-timeline.${nextVersion}`)},
        ${resource.id}, ${nextVersion}, 'CANCELLED', 'IDENTITY',
        ${id("identity.seller")},
        ${id(`${resource.key}.fulfillment-correlation.${nextVersion}`)},
        ${now}, null, null)
      on conflict (id) do nothing
    `;
  }
}
