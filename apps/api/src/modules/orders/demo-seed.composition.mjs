const SHIPPING_FEE = 850000;

export async function convergeOrdersDemoState({ sql, manifest, baseline }) {
  const { id, firstVariant } = baseline.ids;
  const buyerId = id("identity.buyer");
  const storeId = id("store.aban");
  const address = manifest.resources.find(({ kind }) => kind === "address");
  const historicalAddressKey = address?.key ?? "address.buyer-home";
  const activeCart = manifest.resources.find(({ kind }) => kind === "cart");
  if (activeCart) {
    const desiredCartId = id(activeCart.key);
    const desiredCartVariantId = firstVariant(activeCart.product);
    const [currentCart] = await sql`
    select cart.store_id as "storeId", cart.identity_id as "identityId",
      cart.status, cart.revision,
      count(item.*)::int as "itemCount",
      bool_and(item.variant_id = ${desiredCartVariantId}
        and item.product_id = ${id(activeCart.product)}
        and item.quantity = ${activeCart.quantity}) as "itemsMatch"
    from order_carts cart
    left join order_cart_items item on item.cart_id = cart.id
    where cart.id = ${desiredCartId}
    group by cart.id
  `;
    const cartChanged =
      !currentCart ||
      currentCart.storeId !== id(activeCart.store) ||
      currentCart.identityId !== id(activeCart.identity) ||
      currentCart.status !== "ACTIVE" ||
      currentCart.itemCount !== 1 ||
      !currentCart.itemsMatch;
    const cartRevision = currentCart ? currentCart.revision + (cartChanged ? 1 : 0) : 1;

    await sql`
    insert into order_carts
      (id, store_id, identity_id, status, revision, expires_at, created_at,
       updated_at, reviewed_policy_revision, reviewed_shipping_hash)
    values (${desiredCartId}, ${id(activeCart.store)}, ${id(activeCart.identity)},
      'ACTIVE', ${cartRevision}, ${new Date(baseline.now.getTime() + 7 * 86_400_000)},
      ${baseline.atDaysAgo(1)}, ${baseline.now}, 0, '')
    on conflict (id) do update set store_id = excluded.store_id,
      identity_id = excluded.identity_id, status = 'ACTIVE', revision = excluded.revision,
      expires_at = excluded.expires_at, updated_at = excluded.updated_at
  `;
    await sql`
    insert into order_cart_items
      (cart_id, variant_id, product_id, quantity, created_at, updated_at,
       reviewed_publication_version, reviewed_unit_price_amount)
    values (${desiredCartId}, ${desiredCartVariantId},
      ${id(activeCart.product)}, ${activeCart.quantity}, ${baseline.atDaysAgo(1)},
      ${baseline.now}, 0, 0)
    on conflict (cart_id, variant_id) do update set quantity = excluded.quantity,
      updated_at = excluded.updated_at
  `;
    await sql`
    delete from order_cart_items
    where cart_id = ${desiredCartId}
      and variant_id <> ${desiredCartVariantId}
  `;
  }

  if (address) {
    await sql`
    insert into order_saved_addresses
      (id, identity_id, current_revision, status, created_at, updated_at)
    values (${id(address.key)}, ${id(address.identity)}, 1, 'ACTIVE',
      ${baseline.atDaysAgo(20)}, ${baseline.now})
    on conflict (id) do update set identity_id = excluded.identity_id,
      current_revision = 1, status = 'ACTIVE', updated_at = excluded.updated_at
  `;
    await sql`
    insert into order_saved_address_revisions
      (address_id, revision, recipient_name, recipient_mobile, province_text,
       city_text, address_line, postal_code, created_at)
    values (${id(address.key)}, 1, ${address.recipient}, ${address.mobile},
      ${address.province}, ${address.city}, ${address.line}, ${address.postalCode},
      ${baseline.atDaysAgo(20)})
    on conflict (address_id, revision) do nothing
  `;
  }

  for (const order of baseline.orders) {
    const product = baseline.resources.get(order.product);
    const createdAt = baseline.atDaysAgo(order.ageDays, order.ageMinutes ?? 0);
    const cartId = id(`${order.key}.cart`);
    const checkoutId = id(`${order.key}.checkout`);
    const orderId = id(order.key);
    const totalAmount = product.price + SHIPPING_FEE;
    const [existingOrder] = await sql`
      select status from order_orders where id = ${orderId}
    `;
    await sql`
      insert into order_carts
        (id, store_id, identity_id, status, revision, expires_at, created_at,
         updated_at, reviewed_policy_revision, reviewed_shipping_hash)
      values (${cartId}, ${storeId}, ${buyerId}, 'CONVERTED', 1, ${createdAt},
        ${createdAt}, ${createdAt}, 1,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      on conflict (id) do update set status = 'CONVERTED', updated_at = excluded.updated_at
    `;
    await sql`
      insert into order_checkout_preparations
        (checkout_revision, identity_id, cart_id, cart_revision, address_id,
         address_revision, shipping_method_id, shipping_revision, policy_revision,
         snapshot, expires_at, consumed_order_id, created_at)
      values (${checkoutId}, ${buyerId}, ${cartId}, 1, ${id(historicalAddressKey)}, 1,
        ${id("store.aban.shipping")}, 1, 1, ${sql.json({ product: product.name })},
        ${new Date(createdAt.getTime() + 15 * 60_000)}, null, ${createdAt})
      on conflict (checkout_revision) do nothing
    `;
    const paidAt = ["PENDING_PAYMENT", "PAYMENT_REVIEW", "EXPIRED"].includes(
      order.state,
    )
      ? null
      : new Date(createdAt.getTime() + 2 * 60_000);
    await sql`
      insert into order_orders
        (id, identity_id, store_id, checkout_revision, reservation_id, status,
         total_amount, currency, reservation_expires_at, review_snapshot,
         created_at, paid_at)
      values (${orderId}, ${buyerId}, ${storeId}, ${checkoutId},
        ${id(`${order.key}.reservation`)}, ${order.state}, ${totalAmount}, 'IRR',
        ${new Date(createdAt.getTime() + 15 * 60_000)},
        ${sql.json({ settlementKind: "DIRECT", product: product.name })},
        ${createdAt}, ${paidAt})
      on conflict (id) do nothing
    `;
    if (existingOrder && existingOrder.status !== order.state) {
      await sql`
        update order_orders set status = ${order.state}, paid_at = ${paidAt}
        where id = ${orderId}
      `;
      await sql`
        insert into order_state_transitions
          (id, order_id, from_status, to_status, reason_code, actor_kind,
           correlation_id, occurred_at)
        values (${id(`${order.key}.baseline-restored.${order.state}`)}, ${orderId},
          ${existingOrder.status}, ${order.state}, 'DEMO_BASELINE_RESTORED', 'SYSTEM',
          ${id(`${order.key}.baseline-restored-correlation.${order.state}`)},
          ${baseline.now})
        on conflict (id) do nothing
      `;
    }
    await sql`
      update order_checkout_preparations set consumed_order_id = ${orderId}
      where checkout_revision = ${checkoutId}
    `;
    await sql`
      insert into order_items
        (id, order_id, variant_id, product_id, name, quantity,
         unit_price_amount, publication_version)
      values (${id(`${order.key}.item`)}, ${orderId}, ${firstVariant(order.product)},
        ${id(order.product)}, ${product.name}, 1, ${product.price}, 1)
      on conflict (order_id, variant_id) do nothing
    `;
    await seedSnapshots(sql, baseline, orderId, id(historicalAddressKey));
    await seedOrderHistory(sql, baseline, order, paidAt);
  }
}

async function seedSnapshots(sql, baseline, orderId, addressId) {
  await sql`
    insert into order_delivery_snapshots
      (order_id, address_id, address_revision, recipient_name, recipient_mobile,
       province_text, city_text, address_line, postal_code)
    values (${orderId}, ${addressId}, 1, 'نیلوفر مرادی', '09000000001',
      'تهران', 'تهران', 'خیابان نمونه، کوچه آزمایش، پلاک ۱۲', '1234567890')
    on conflict (order_id) do nothing
  `;
  await sql`
    insert into order_shipping_snapshots
      (order_id, shipping_method_id, shipping_method_revision, code, label,
       fee_amount, estimated_delivery_text)
    values (${orderId}, ${baseline.ids.id("store.aban.shipping")}, 1,
      'NATIONAL_POST', 'پست پیشتاز', ${SHIPPING_FEE}, '۳ تا ۵ روز کاری')
    on conflict (order_id) do nothing
  `;
  await sql`
    insert into order_policy_snapshots (order_id, revision, text)
    values (${orderId}, 1,
      'تا ۷ روز پس از تحویل، درخواست مرجوعی را با فروشنده هماهنگ کنید.')
    on conflict (order_id) do nothing
  `;
}

async function seedOrderHistory(sql, baseline, order, paidAt) {
  const { id } = baseline.ids;
  const createdAt = baseline.atDaysAgo(order.ageDays, order.ageMinutes ?? 0);
  const transitions = [{ from: null, to: "PENDING_PAYMENT", at: createdAt }];
  if (order.state === "PAYMENT_REVIEW") {
    transitions.push({
      from: "PENDING_PAYMENT",
      to: "PAYMENT_REVIEW",
      at: new Date(createdAt.getTime() + 2 * 60_000),
    });
  } else if (order.state === "EXPIRED") {
    transitions.push({
      from: "PENDING_PAYMENT",
      to: "EXPIRED",
      at: new Date(createdAt.getTime() + 15 * 60_000),
    });
  } else if (paidAt) {
    transitions.push({ from: "PENDING_PAYMENT", to: order.state, at: paidAt });
  }
  for (const [index, transition] of transitions.entries()) {
    await sql`
      insert into order_state_transitions
        (id, order_id, from_status, to_status, reason_code, actor_kind,
         correlation_id, occurred_at)
      values (${id(`${order.key}.order-transition.${index + 1}`)}, ${id(order.key)},
        ${transition.from}, ${transition.to}, 'DEMO_BASELINE', 'SYSTEM',
        ${id(`${order.key}.order-correlation.${index + 1}`)}, ${transition.at})
      on conflict (id) do nothing
    `;
  }
}

export async function retireOrdersDemoState({ sql, retired, id, now }) {
  for (const resource of retired) {
    if (resource.key.startsWith("cart.")) {
      await sql`update order_carts set status = 'EXPIRED', updated_at = ${now} where id = ${resource.id}`;
    }
    if (resource.key.startsWith("address.")) {
      await sql`update order_saved_addresses set status = 'DELETED', updated_at = ${now} where id = ${resource.id}`;
    }
    if (resource.key.startsWith("order.")) {
      const [order] = await sql`
        select status from order_orders where id = ${resource.id}
      `;
      if (order && !["EXPIRED", "CANCELLED"].includes(order.status)) {
        await sql`update order_orders set status = 'CANCELLED' where id = ${resource.id}`;
        await sql`
          insert into order_state_transitions
            (id, order_id, from_status, to_status, reason_code, actor_kind,
             correlation_id, occurred_at)
          values (${id(`${resource.key}.retirement-transition`)}, ${resource.id},
            ${order.status}, 'CANCELLED', 'DEMO_RESOURCE_RETIRED', 'SYSTEM',
            ${id(`${resource.key}.retirement-correlation`)}, ${now})
          on conflict (id) do nothing
        `;
      }
    }
  }
}

export async function convergeOrderFulfillmentProjections({
  sql,
  baseline,
  fulfillmentStates,
}) {
  const { id } = baseline.ids;
  for (const state of fulfillmentStates.filter(({ status }) =>
    ["ACTION_REQUIRED", "PREPARING", "SHIPPED", "DELIVERED"].includes(status),
  )) {
    await sql`
      insert into order_fulfillment_status_projections
        (order_id, status, version, accepted_event_id, updated_at)
      values (${id(state.orderKey)}, ${state.status}, ${state.version},
        ${id(`${state.orderKey}.order-fulfillment-event.${state.version}`)},
        ${baseline.now})
      on conflict (order_id) do update set status = excluded.status,
        version = excluded.version, accepted_event_id = excluded.accepted_event_id,
        updated_at = excluded.updated_at
    `;
  }
}
