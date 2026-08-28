import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  differentStoreCartConflictTestMobiles,
  guestCartTestMobiles,
  sameStoreCartConflictTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("guest adds a product, signs in and continues the same cart", async ({
  page,
}, testInfo) => {
  const projectIndex = visualProjectIndex(testInfo.project.name);
  const mobile = guestCartTestMobiles[projectIndex]!;
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const ids = {
    store: randomUUID(),
    seller: randomUUID(),
    product: randomUUID(),
    variant: randomUUID(),
    media: randomUUID(),
    shipping: randomUUID(),
  };
  const slug = `guest-cart-${projectIndex}`;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const previousStores = await sql<Array<{ storeId: string }>>`
      select id as "storeId" from store_stores where slug = ${slug}
    `;
    for (const previous of previousStores) {
      await sql`
        delete from order_delivery_snapshots where order_id in
          (select id from order_orders where store_id = ${previous.storeId}::uuid)
      `;
      await sql`
        delete from order_shipping_snapshots where order_id in
          (select id from order_orders where store_id = ${previous.storeId}::uuid)
      `;
      await sql`
        delete from order_policy_snapshots where order_id in
          (select id from order_orders where store_id = ${previous.storeId}::uuid)
      `;
      await sql`
        delete from order_items where order_id in
          (select id from order_orders where store_id = ${previous.storeId}::uuid)
      `;
      await sql`
        delete from inventory_reservation_lines where reservation_id in
          (select id from inventory_reservations where store_id = ${previous.storeId}::uuid)
      `;
      await sql`delete from inventory_reservations where store_id = ${previous.storeId}::uuid`;
      await sql`
        update order_checkout_preparations set consumed_order_id = null
        where cart_id in
          (select id from order_carts where store_id = ${previous.storeId}::uuid)
      `;
      await sql`delete from order_orders where store_id = ${previous.storeId}::uuid`;
      await sql`
        delete from order_checkout_preparations where cart_id in
          (select id from order_carts where store_id = ${previous.storeId}::uuid)
      `;
      await sql`delete from order_carts where store_id = ${previous.storeId}::uuid`;
      await sql`delete from product_products where store_id = ${previous.storeId}::uuid`;
      await sql`delete from store_stores where id = ${previous.storeId}::uuid`;
    }
    const identities = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId" from identity_login_methods
      where mobile = ${mobile}
    `;
    if (identities[0]) {
      await sql`
        delete from order_carts where identity_id = ${identities[0].identityId}::uuid
      `;
    }
    await sql`
      insert into store_stores
        (id, name, slug, return_policy, return_policy_revision,
         settlement_kind, settlement_status, settlement_verified_at,
         status, publication_version, revision, updated_at)
      values
        (${ids.store}, 'خانه فنجان', ${slug},
         'تا هفت روز امکان درخواست مرجوعی دارید.', 1,
         'TEST', 'TEST_VERIFIED', now(), 'PUBLISHED', 1, 1, now())
    `;
    await sql`
      insert into store_shipping_methods
        (id, store_id, position, revision, code, label, fixed_fee_amount,
         estimated_delivery_text, enabled, requires_delivery_address,
         requires_postal_code)
      values
        (${ids.shipping}, ${ids.store}, 0, 1, 'NATIONAL_POST', 'پست پیشتاز',
         500000, '۳ تا ۵ روز کاری', true, true, true)
    `;
    await sql`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${randomUUID()}, ${ids.store}, ${ids.seller}, 'OWNER')
    `;
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at)
      values (${ids.product}, ${ids.store}, 'PUBLISHED', 2, 1, now())
    `;
    await sql`
      insert into product_variants
        (id, product_id, store_id, client_key, combination_key,
         retired, ever_published)
      values
        (${ids.variant}, ${ids.product}, ${ids.store}, 'legacy-default',
         'legacy-default', false, true)
    `;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id, variant_id)
      values
        (${ids.product}, 1, 'فنجان سرامیکی', 'فنجان دست‌ساز مناسب نوشیدنی گرم',
         ${ids.media}, ${ids.variant})
    `;
    await sql`
      insert into product_offers (product_id, variant_id, amount, currency, revision)
      values (${ids.product}, ${ids.variant}, 4500000, 'IRR', 1)
    `;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${ids.variant}, ${ids.store}, 8, 1)
    `;
  } finally {
    await sql.end();
  }

  await page.goto(`/s/${slug}/products/${ids.product}`);
  await expect(page.getByRole("heading", { name: "فنجان سرامیکی" })).toBeVisible();
  await page.getByLabel("تعداد").selectOption("2");
  await page.getByRole("button", { name: "افزودن به سبد" }).click();
  await expect(page.getByText("به سبد اضافه شد.")).toBeVisible();
  await page.getByRole("link", { name: "دیدن سبد" }).click();

  await expect(page.getByRole("heading", { name: "سبد شما" })).toBeVisible();
  await expect(page.getByText("فنجان سرامیکی")).toBeVisible();
  await expect(page.getByText("تعداد ۲")).toBeVisible();
  await page.reload();
  await expect(page.getByText("فنجان سرامیکی")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page);

  const otherTab = await page.context().newPage();
  await otherTab.goto("/cart");
  await otherTab.getByRole("button", { name: "بیشترکردن تعداد فنجان سرامیکی" }).click();
  await expect(otherTab.getByText("تعداد ۳")).toBeVisible();
  await page.getByRole("button", { name: "حذف فنجان سرامیکی" }).click();
  await expect(
    page.getByText("سبد در جای دیگری تغییر کرده است. نسخه تازه را بررسی کنید."),
  ).toBeVisible();
  await expect(page.getByText("تعداد ۳")).toBeVisible();
  await otherTab.close();

  await page.getByRole("button", { name: "ادامه برای ثبت سفارش" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "ورود به سوو" })).toBeVisible();
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();

  await expect(page).toHaveURL(/\/cart\?continue=1$/);
  await expect(page.getByText("فنجان سرامیکی")).toBeVisible();
  await expect(page.getByText("تعداد ۳")).toBeVisible();
  await page.getByRole("button", { name: "ادامه برای ثبت سفارش" }).click();
  await expect(
    page.getByText("سبد به هویت سوو متصل شد و برای ادامه خرید آماده است."),
  ).toBeVisible();
  const reviewSql = postgres(databaseUrl, { max: 1 });
  try {
    await reviewSql`
      update product_offers set amount = 5000000, revision = revision + 1
      where variant_id = ${ids.variant}
    `;
    await reviewSql`
      update store_stores set
        return_policy = 'تا هفت روز پس از تحویل می‌توانید درخواست مرجوعی ثبت کنید.',
        return_policy_revision = return_policy_revision + 1,
        revision = revision + 1
      where id = ${ids.store}
    `;
  } finally {
    await reviewSql.end();
  }
  await page.reload();
  await expect(
    page.getByText("قیمت از ۴۵۰٬۰۰۰ تومان به ۵۰۰٬۰۰۰ تومان تغییر کرده است."),
  ).toBeVisible();
  await expect(
    page.getByText("تا هفت روز پس از تحویل می‌توانید درخواست مرجوعی ثبت کنید."),
  ).toBeVisible();
  await page.getByRole("button", { name: "تغییرها را دیدم" }).click();
  await expect(page.getByText("تغییرهای سبد تأیید شد.")).toBeVisible();
  await page.getByRole("link", { name: "مدیریت نشانی‌های تحویل" }).click();
  await expect(page.getByRole("heading", { name: "نشانی تحویل" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByLabel("نام گیرنده").focus();
  await expect(page.getByLabel("نام گیرنده")).toBeFocused();
  expect(
    await page
      .getByLabel("نام گیرنده")
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("شماره موبایل گیرنده")).toBeFocused();
  await page.getByLabel("نام گیرنده").fill("سارا احمدی");
  await page.getByLabel("شماره موبایل گیرنده").fill("۰۹۱۲۳۴۵۶۷۸۹");
  await page.getByLabel("استان").fill("تهران");
  await page.getByLabel("شهر").fill("تهران");
  const longAddress =
    "خیابان آزادی، بعد از میدان اصلی، کوچه بهار، ساختمان سپید، ورودی دوم، طبقه چهارم، واحد دوازده، زنگ احمدی";
  await page.getByLabel("نشانی کامل").fill(longAddress);
  await page.getByLabel("کدپستی (در صورت نیاز)").fill("۱۲۳۴۵۶۷۸۹۰");
  await page.getByRole("button", { name: "ذخیره نشانی" }).click();
  await expect(page.getByText("نشانی ذخیره شد.")).toBeVisible();
  await expect(page.getByText(longAddress).first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page);
  await assertMinimumContrast(page.locator("main input, main textarea, main button"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .getByLabel("نام گیرنده")
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).transitionDuration),
      ),
  ).toBeLessThan(0.001);
  await page.getByRole("link", { name: "بازگشت به سبد" }).click();
  await page.getByRole("button", { name: "ادامه برای ثبت سفارش" }).click();
  await page.getByRole("link", { name: "ادامه به تحویل سفارش" }).click();
  await expect(page).toHaveURL(/\/checkout\/delivery$/);
  await expect(page.getByRole("heading", { name: "تحویل سفارش" })).toBeVisible();
  await page.getByRole("button", { name: "دیدن مبلغ نهایی" }).click();
  await expect(page).toHaveURL(/\/checkout\/review$/);
  await expect(page.getByRole("heading", { name: "تسویه مستقیم" })).toBeVisible();
  await expect(page.getByText("بازپرداخت را تضمین نمی‌کند.")).toBeVisible();
  const stockSql = postgres(databaseUrl, { max: 1 });
  try {
    await stockSql`
      update inventory_levels set on_hand = 0, revision = revision + 1
      where variant_id = ${ids.variant}
    `;
    await page.getByRole("button", { name: /ثبت سفارش و پرداخت/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "سبد را اصلاح" }),
    ).toBeVisible();
    await stockSql`
      update inventory_levels set on_hand = 8, revision = revision + 1
      where variant_id = ${ids.variant}
    `;
  } finally {
    await stockSql.end();
  }
  await page.getByRole("button", { name: /ثبت سفارش و پرداخت/ }).click();
  await expect(page.getByRole("heading", { name: "سفارش ثبت شد" })).toBeVisible();
  await assertNoHorizontalOverflow(page);

  const historySql = postgres(databaseUrl, { max: 1 });
  try {
    const orders = await historySql<Array<{ orderId: string; reservationId: string }>>`
      select id as "orderId", reservation_id as "reservationId"
      from order_orders where store_id = ${ids.store}
      order by created_at desc limit 1
    `;
    const created = orders[0];
    if (!created) throw new Error("The browser checkout must persist an order");
    const originalSnapshots = await historySql`
      select address_id, address_revision, recipient_name, recipient_mobile,
        province_text, city_text, address_line, postal_code
      from order_delivery_snapshots where order_id = ${created.orderId}
    `;
    expect(originalSnapshots).toHaveLength(1);
    const addresses = await historySql<Array<{ addressId: string; revision: number }>>`
      select address.id as "addressId", address.current_revision as revision
      from order_saved_addresses address
      join identity_login_methods login on login.identity_id = address.identity_id
      where login.mobile = ${mobile} and address.status = 'ACTIVE'
      order by address.updated_at desc limit 1
    `;
    const selectedAddress = addresses[0];
    if (!selectedAddress) throw new Error("Checkout must use a saved address");
    const nextRevision = selectedAddress.revision + 1;
    await historySql`
      insert into order_saved_address_revisions
        (address_id, revision, recipient_name, recipient_mobile, province_text,
         city_text, address_line, postal_code)
      values
        (${selectedAddress.addressId}, ${nextRevision}, 'گیرنده تازه',
         '09121111111', 'فارس', 'شیراز', 'نشانی تازه', '9876543210')
    `;
    await historySql`
      update order_saved_addresses
      set current_revision = ${nextRevision}, status = 'DELETED', updated_at = now()
      where id = ${selectedAddress.addressId}
    `;
    expect(
      await historySql`
        select address_id, address_revision, recipient_name, recipient_mobile,
          province_text, city_text, address_line, postal_code
        from order_delivery_snapshots where order_id = ${created.orderId}
      `,
    ).toEqual(originalSnapshots);

    await historySql`
      update order_orders set reservation_expires_at = now() - interval '1 second'
      where id = ${created.orderId}
    `;
    await historySql`
      update inventory_reservations set expires_at = now() - interval '1 second'
      where id = ${created.reservationId}
    `;
    await page.goto("/checkout");
    await expect
      .poll(async () => {
        const rows = await historySql<
          Array<{ orderStatus: string; reservationStatus: string }>
        >`
          select orders.status as "orderStatus", reservation.status as "reservationStatus"
          from order_orders orders
          join inventory_reservations reservation
            on reservation.id = orders.reservation_id
          where orders.id = ${created.orderId}
        `;
        return rows[0];
      })
      .toEqual({ orderStatus: "EXPIRED", reservationStatus: "RELEASED" });
    expect(
      await historySql`
        select event_id from platform_outbox_events
        where aggregate_id = ${created.orderId} and event_type = 'OrderExpired.v1'
      `,
    ).toHaveLength(1);
    expect(
      await historySql<Array<{ available: number }>>`
        select (level.on_hand - coalesce(sum(line.quantity) filter (
          where reservation.status = 'ACTIVE' and reservation.expires_at > now()
        ), 0))::int as available
        from inventory_levels level
        left join inventory_reservation_lines line on line.variant_id = level.variant_id
        left join inventory_reservations reservation
          on reservation.id = line.reservation_id
        where level.variant_id = ${ids.variant}
        group by level.variant_id
      `,
    ).toEqual([{ available: 8 }]);
  } finally {
    await historySql.end();
  }
});

test("same-store carts merge only after the buyer chooses merge", async ({
  page,
}, testInfo) => {
  const projectIndex = visualProjectIndex(testInfo.project.name);
  const mobile = sameStoreCartConflictTestMobiles[projectIndex]!;
  const fixture = await seedCartConflict(mobile, projectIndex, false);

  await addGuestProductAndSignIn(
    page,
    fixture.guestSlug,
    fixture.guestProductId,
    mobile,
  );
  await expect(
    page.getByRole("heading", { name: "کدام سبد را ادامه می‌دهید؟" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "ترکیب دو سبد" })).toBeVisible();
  await expect(
    page.getByText("سبد پیش از ورود ۱ کالا و سبد هویت سوو شما ۱ کالا دارد."),
  ).toBeVisible();
  await expect(
    page.getByText("پیش از ورود: ۲، هویت سوو من: ۳، پس از ترکیب: ۵"),
  ).toBeVisible();
  await expect(page.getByText("تعداد ۳")).toBeVisible();
  await page.getByRole("button", { name: "ترکیب دو سبد" }).click();
  await expect(page.getByText("تعداد ۵")).toBeVisible();
  await expect(
    page.getByText("انتخاب شما انجام شد و سبد آماده ادامه خرید است."),
  ).toBeVisible();
});

test("different-store carts change only after the buyer chooses which one to keep", async ({
  page,
}, testInfo) => {
  const projectIndex = visualProjectIndex(testInfo.project.name);
  const mobile = differentStoreCartConflictTestMobiles[projectIndex]!;
  const fixture = await seedCartConflict(mobile, projectIndex, true);

  await addGuestProductAndSignIn(
    page,
    fixture.guestSlug,
    fixture.guestProductId,
    mobile,
  );
  await expect(
    page.getByRole("heading", { name: "کدام سبد را ادامه می‌دهید؟" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "ترکیب دو سبد" })).toHaveCount(0);
  await expect(
    page.getByText("سبد پیش از ورود ۱ کالا و سبد هویت سوو شما ۱ کالا دارد."),
  ).toBeVisible();
  await expect(page.getByText("کالای حساب")).toBeVisible();
  await page.getByRole("button", { name: "نگه‌داشتن سبد پیش از ورود" }).click();
  await expect(page.getByText("کالای مهمان")).toBeVisible();
  await expect(page.getByText("تعداد ۲")).toBeVisible();
});

async function addGuestProductAndSignIn(
  page: import("@playwright/test").Page,
  slug: string,
  productId: string,
  mobile: string,
) {
  await page.goto(`/s/${slug}/products/${productId}`);
  await page.getByLabel("تعداد").selectOption("2");
  await page.getByRole("button", { name: "افزودن به سبد" }).click();
  await page.getByRole("link", { name: "دیدن سبد" }).click();
  await page.getByRole("button", { name: "ادامه برای ثبت سفارش" }).click();
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/cart\?continue=1$/);
}

async function seedCartConflict(
  mobile: string,
  projectIndex: number,
  differentStore: boolean,
) {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const buyer = productFixture(
    `buyer-${differentStore ? "different" : "same"}-${projectIndex}`,
  );
  const guest = differentStore
    ? productFixture(`guest-different-${projectIndex}`)
    : buyer;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const existing = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId" from identity_login_methods where mobile = ${mobile}
    `;
    const identityId = existing[0]?.identityId ?? randomUUID();
    if (!existing[0]) {
      await sql`
        insert into identity_identities (id, status, created_at)
        values (${identityId}, 'ACTIVE', now())
      `;
      await sql`
        insert into identity_login_methods
          (id, identity_id, kind, mobile, verified_at, created_at)
        values (${randomUUID()}, ${identityId}, 'MOBILE', ${mobile}, now(), now())
      `;
    }
    await sql`delete from order_carts where identity_id = ${identityId}::uuid`;
    for (const fixture of differentStore ? [buyer, guest] : [buyer]) {
      const prior = await sql<Array<{ id: string }>>`
        select id from store_stores where slug = ${fixture.slug}
      `;
      for (const row of prior) {
        await sql`delete from order_carts where store_id = ${row.id}::uuid`;
        await sql`delete from product_products where store_id = ${row.id}::uuid`;
        await sql`delete from store_stores where id = ${row.id}::uuid`;
      }
      await sql`
        insert into store_stores
          (id, name, slug, status, publication_version, revision, updated_at)
        values
          (${fixture.storeId}, ${fixture.storeName}, ${fixture.slug}, 'PUBLISHED', 1, 1, now())
      `;
      await sql`
        insert into store_memberships (id, store_id, seller_id, role)
        values (${randomUUID()}, ${fixture.storeId}, ${randomUUID()}, 'OWNER')
      `;
      await sql`
        insert into product_products
          (id, store_id, state, revision, publication_version, published_at)
        values (${fixture.productId}, ${fixture.storeId}, 'PUBLISHED', 2, 1, now())
      `;
      await sql`
        insert into product_variants
          (id, product_id, store_id, client_key, combination_key,
           retired, ever_published)
        values
          (${fixture.variantId}, ${fixture.productId}, ${fixture.storeId},
           'legacy-default', 'legacy-default', false, true)
      `;
      await sql`
        insert into product_publications
          (product_id, publication_version, name, description, media_id, variant_id)
        values
          (${fixture.productId}, 1, ${fixture.productName}, 'شرح کالا',
           ${fixture.mediaId}, ${fixture.variantId})
      `;
      await sql`
        insert into product_offers (product_id, variant_id, amount, currency, revision)
        values (${fixture.productId}, ${fixture.variantId}, 4500000, 'IRR', 1)
      `;
      await sql`
        insert into inventory_levels (variant_id, store_id, on_hand, revision)
        values (${fixture.variantId}, ${fixture.storeId}, 20, 1)
      `;
    }
    const cartId = randomUUID();
    await sql`
      insert into order_carts
        (id, store_id, identity_id, status, revision, expires_at, updated_at)
      values
        (${cartId}, ${buyer.storeId}, ${identityId}, 'ACTIVE', 1,
         now() + interval '30 days', now())
    `;
    await sql`
      insert into order_cart_items
        (cart_id, variant_id, product_id, quantity, updated_at)
      values (${cartId}, ${buyer.variantId}, ${buyer.productId}, 3, now())
    `;
  } finally {
    await sql.end();
  }
  return { guestSlug: guest.slug, guestProductId: guest.productId };
}

function productFixture(slug: string) {
  return {
    slug,
    storeId: randomUUID(),
    storeName: slug.startsWith("buyer") ? "فروشگاه حساب" : "فروشگاه مهمان",
    productId: randomUUID(),
    productName: slug.startsWith("buyer") ? "کالای حساب" : "کالای مهمان",
    variantId: randomUUID(),
    mediaId: randomUUID(),
  };
}
