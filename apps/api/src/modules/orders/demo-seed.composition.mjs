const SHIPPING_FEE = 850000;
const RETURN_POLICY = "تا ۷ روز پس از تحویل، درخواست مرجوعی را با فروشنده هماهنگ کنید.";
const DIRECT_SETTLEMENT_DISCLOSURE =
  "مبلغ این سفارش مستقیماً برای فروشگاه تسویه می‌شود. سیاست مرجوعی را فروشگاه تعیین می‌کند. سوو گزارش مشکل و تخلف را پیگیری می‌کند، اما بازپرداخت را تضمین نمی‌کند.";

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
    const expiresAt = new Date(createdAt.getTime() + 15 * 60_000);
    const reviewSnapshot = buildReviewSnapshot({
      baseline,
      order,
      product,
      cartId,
      checkoutId,
      addressId: id(historicalAddressKey),
      expiresAt,
    });
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
        ${id("store.aban.shipping")}, 1, 1, ${sql.json(reviewSnapshot)},
        ${expiresAt}, null, ${createdAt})
      on conflict (checkout_revision) do update set snapshot = excluded.snapshot,
        expires_at = excluded.expires_at
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
        ${expiresAt}, ${sql.json(reviewSnapshot)},
        ${createdAt}, ${paidAt})
      on conflict (id) do update set status = excluded.status,
        total_amount = excluded.total_amount,
        currency = excluded.currency,
        reservation_expires_at = excluded.reservation_expires_at,
        review_snapshot = excluded.review_snapshot,
        created_at = excluded.created_at, paid_at = excluded.paid_at
    `;
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

function buildReviewSnapshot({
  baseline,
  order,
  product,
  cartId,
  checkoutId,
  addressId,
  expiresAt,
}) {
  const { id, firstVariant } = baseline.ids;
  return {
    checkoutRevision: checkoutId,
    expiresAt: expiresAt.toISOString(),
    cart: { cartId, revision: 1 },
    store: {
      storeId: id("store.aban"),
      name: baseline.resources.get("store.aban").name,
    },
    items: [
      {
        productId: id(order.product),
        variantId: firstVariant(order.product),
        name: product.name,
        quantity: 1,
        publicationVersion: 1,
        unitPrice: { amount: product.price, currency: "IRR" },
        lineTotal: { amount: product.price, currency: "IRR" },
      },
    ],
    address: {
      addressId,
      revision: 1,
      recipientName: "نیلوفر مرادی",
      recipientMobile: "09000000001",
      provinceText: "تهران",
      cityText: "تهران",
      addressLine: "خیابان نمونه، کوچه آزمایش، پلاک ۱۲",
      postalCode: "1234567890",
    },
    shippingMethod: {
      id: id("store.aban.shipping"),
      revision: 1,
      code: "NATIONAL_POST",
      label: "پست پیشتاز",
      fee: { amount: SHIPPING_FEE, currency: "IRR" },
      estimatedDeliveryText: "۳ تا ۵ روز کاری",
      requiresDeliveryAddress: true,
    },
    returnPolicy: { revision: 1, text: RETURN_POLICY },
    subtotal: { amount: product.price, currency: "IRR" },
    total: { amount: product.price + SHIPPING_FEE, currency: "IRR" },
    settlement: { mode: "DIRECT", disclosure: DIRECT_SETTLEMENT_DISCLOSURE },
  };
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
    values (${orderId}, 1, ${RETURN_POLICY})
    on conflict (order_id) do nothing
  `;
}

async function seedOrderHistory(sql, baseline, order, paidAt) {
  const { id } = baseline.ids;
  const createdAt = baseline.atDaysAgo(order.ageDays, order.ageMinutes ?? 0);
  const transitions = [];
  if (order.state === "PAYMENT_REVIEW") {
    transitions.push({
      from: "PENDING_PAYMENT",
      to: "PAYMENT_REVIEW",
      reason: "PAYMENT_DISPATCH_UNRESOLVED",
      at: new Date(createdAt.getTime() + 2 * 60_000),
    });
  } else if (order.state === "EXPIRED") {
    transitions.push({
      from: "PENDING_PAYMENT",
      to: "EXPIRED",
      reason: "PAYMENT_FAILED",
      at: new Date(createdAt.getTime() + 15 * 60_000),
    });
  } else if (paidAt) {
    transitions.push({
      from: "PENDING_PAYMENT",
      to: "PAID",
      reason: "PAYMENT_CONFIRMED",
      at: paidAt,
    });
    if (order.state === "CANCELLATION_PENDING_REFUND" || order.state === "CANCELLED") {
      transitions.push({
        from: "PAID",
        to: "CANCELLATION_PENDING_REFUND",
        reason: "REFUND_REQUESTED",
        at: new Date(paidAt.getTime() + 60_000),
      });
    }
    if (order.state === "CANCELLED") {
      transitions.push({
        from: "CANCELLATION_PENDING_REFUND",
        to: "CANCELLED",
        reason: "REFUND_CONFIRMED",
        at: new Date(paidAt.getTime() + 2 * 60_000),
      });
    }
  }
  await sql`delete from order_state_transitions where order_id = ${id(order.key)}`;
  for (const [index, transition] of transitions.entries()) {
    await sql`
      insert into order_state_transitions
        (id, order_id, from_status, to_status, reason_code, actor_kind,
         correlation_id, occurred_at)
      values (${id(`${order.key}.order-transition.${index + 1}`)}, ${id(order.key)},
        ${transition.from}, ${transition.to}, ${transition.reason}, 'SYSTEM',
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
