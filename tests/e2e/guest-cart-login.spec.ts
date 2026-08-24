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
  };
  const slug = `guest-cart-${projectIndex}`;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const previousStores = await sql<Array<{ storeId: string }>>`
      select id as "storeId" from store_stores where slug = ${slug}
    `;
    for (const previous of previousStores) {
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
        (id, name, slug, status, publication_version, revision, updated_at)
      values
        (${ids.store}, 'خانه فنجان', ${slug}, 'PUBLISHED', 1, 1, now())
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
      insert into product_variants
        (id, product_id, store_id, client_key, combination_key)
      values (${ids.variant}, ${ids.product}, ${ids.store}, 'simple', '')
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
        insert into product_variants
          (id, product_id, store_id, client_key, combination_key)
        values
          (${fixture.variantId}, ${fixture.productId}, ${fixture.storeId}, 'simple', '')
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
