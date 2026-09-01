import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

import {
  paymentBuyerTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("eligible buyer retries once and publishes one verified purchase experience", async ({
  page,
}, testInfo) => {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  const mobile = paymentBuyerTestMobiles[visualProjectIndex(testInfo.project.name)]!;
  const orderItemId = randomUUID();
  const storeId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const mediaId = randomUUID();
  const shippingMethodId = randomUUID();
  const slug = `purchase-experience-${visualProjectIndex(testInfo.project.name)}`;
  const cartId = randomUUID();
  const checkoutId = randomUUID();
  const orderId = randomUUID();
  let orderCreated = false;
  try {
    await page.goto("/login?next=/");
    await page.getByLabel("شماره موبایل").fill(mobile);
    await page.getByRole("button", { name: "دریافت کد" }).click();
    await page.getByLabel("کد شش‌رقمی").fill("111111");
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login")),
      page.getByRole("button", { name: "ورود" }).click(),
    ]);
    const [identity] = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId"
      from identity_login_methods where mobile = ${mobile}
    `;
    const buyerId = identity?.identityId;
    if (!buyerId) throw new Error("Buyer login did not create an identity");
    await sql`
      insert into store_stores
        (id, name, slug, bio, return_policy, return_policy_revision,
         settlement_kind, settlement_status, settlement_verified_at,
         status, published_at, publication_version, revision, updated_at)
      values
        (${storeId}, 'فروشگاه تجربه', ${slug}, 'کالاهای آزمون تجربه خرید',
         'تا هفت روز امکان درخواست مرجوعی دارید.', 1,
         'TEST', 'TEST_VERIFIED', now(), 'PUBLISHED', now(), 1, 1, now())
    `;
    await sql`
      insert into store_shipping_methods
        (id, store_id, position, revision, code, label, fixed_fee_amount,
         estimated_delivery_text, enabled, requires_delivery_address,
         requires_postal_code)
      values (${shippingMethodId}, ${storeId}, 0, 1, 'NATIONAL_POST',
        'پست پیشتاز', 500000, '۳ تا ۵ روز کاری', true, true, true)
    `;
    await sql`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${randomUUID()}, ${storeId}, ${buyerId}, 'OWNER')
    `;
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at)
      values (${productId}, ${storeId}, 'PUBLISHED', 2, 1, now())
    `;
    await sql`
      insert into product_variants
        (id, product_id, store_id, client_key, combination_key,
         retired, ever_published)
      values (${variantId}, ${productId}, ${storeId}, 'default', 'default',
        false, true)
    `;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id, variant_id)
      values (${productId}, 1, 'کالای تأییدشده',
        'شرح کالای تأییدشده برای نمایش عمومی تجربه', ${mediaId}, ${variantId})
    `;
    await sql`
      insert into product_offers (product_id, variant_id, amount, currency, revision)
      values (${productId}, ${variantId}, 1000, 'IRR', 1)
    `;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${variantId}, ${storeId}, 8, 1)
    `;
    await sql`
      insert into order_carts
        (id, store_id, identity_id, status, revision, expires_at)
      values (${cartId}, ${storeId}, ${buyerId}, 'CONVERTED', 1,
        now() + interval '1 day')
    `;
    await sql`
      insert into order_checkout_preparations
        (checkout_revision, identity_id, cart_id, cart_revision,
         shipping_method_id, shipping_revision, policy_revision, snapshot, expires_at)
      values (${checkoutId}, ${buyerId}, ${cartId}, 1, ${randomUUID()}, 1, 1,
        ${sql.json({})}, now() + interval '1 day')
    `;
    await sql`
      insert into order_orders
        (id, identity_id, store_id, checkout_revision, reservation_id, status,
         total_amount, currency, reservation_expires_at, review_snapshot, paid_at)
      values (${orderId}, ${buyerId}, ${storeId}, ${checkoutId}, ${randomUUID()},
        'PAID', 1000, 'IRR', now() + interval '1 day', ${sql.json({})}, now())
    `;
    await sql`
      insert into order_items
        (id, order_id, variant_id, product_id, name, quantity,
         unit_price_amount, publication_version)
      values (${orderItemId}, ${orderId}, ${variantId}, ${productId},
        'کالای تأییدشده', 1, 1000, 1)
    `;
    orderCreated = true;

    const requestKeys: string[] = [];
    let interrupted = false;
    await page.route(/\/api\/purchase-experiences$/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      requestKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (!interrupted) {
        interrupted = true;
        return route.abort("connectionfailed");
      }
      return route.continue();
    });

    const returnTo = `/orders/${randomUUID()}`;
    await page.goto(
      `/purchase-experiences/new?${new URLSearchParams({ orderItemId, returnTo })}`,
    );
    await expect(
      page.getByRole("heading", { name: "تجربه این خرید را ثبت کنید" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByRole("radio", { name: "۵" }).check();
    await page
      .getByLabel("توضیح شما (اختیاری)")
      .fill("کالا دقیقاً مطابق توضیح رسید و بسته‌بندی مرتب بود. ".repeat(8));

    await page.getByRole("button", { name: "ثبت تجربه خرید" }).click();
    await expect(
      page.getByText("ارتباط با سرور کامل نشد. دوباره تلاش کنید.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "ثبت تجربه خرید" }).click();
    await expect(page.getByText("منتشر شد", { exact: true })).toBeVisible();
    expect(requestKeys).toHaveLength(2);
    expect(requestKeys[0]).toBeTruthy();
    expect(requestKeys[1]).toBe(requestKeys[0]);

    const [experience] = await sql<
      Array<{ experienceId: string; source: string; moderationState: string }>
    >`
      select id as "experienceId", source,
        moderation_state as "moderationState"
      from content_purchase_experiences where order_item_id = ${orderItemId}
    `;
    expect(experience).toMatchObject({
      source: "VERIFIED_PURCHASE",
      moderationState: "PUBLISHED",
    });
    const feed = await page.request.get(
      `http://127.0.0.1:${process.env.SEVO_E2E_API_PORT ?? "3109"}/v2/products/${productId}/purchase-experiences`,
    );
    expect(await feed.json()).toMatchObject({
      summary: { verifiedPurchaseCount: 1, averageRating: null },
      experiences: [
        {
          experienceId: experience?.experienceId,
          source: "VERIFIED_PURCHASE",
          moderationState: "PUBLISHED",
        },
      ],
    });

    await page.goto(`/s/${slug}/products/${productId}`);
    await expect(page.getByRole("heading", { name: "تجربه‌های خرید" })).toBeVisible();
    await expect(page.getByText("۱ خرید تأییدشده")).toContainText(
      "برای نمایش میانگین هنوز نمونه کافی نیست",
    );
    await expect(page.getByText("خرید تأییدشده", { exact: true })).toBeVisible();
    await expect(
      page.getByText("کالا دقیقاً مطابق توضیح رسید و بسته‌بندی مرتب بود.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByText(/میانگین [۰-۹]/)).toHaveCount(0);
    await sql`
      insert into content_purchase_experiences
        (id, buyer_identity_id, order_item_id, store_id, product_id,
         moderation_state, rating, text, media_ids)
      values
        (${randomUUID()}, ${buyerId}, ${randomUUID()}, ${storeId}, ${productId},
         'PUBLISHED', 4, 'تجربه دوم برای آستانه', '{}'),
        (${randomUUID()}, ${buyerId}, ${randomUUID()}, ${storeId}, ${productId},
         'PUBLISHED', 3, 'تجربه سوم برای آستانه', '{}')
    `;
    await page.reload();
    await expect(page.getByText("۳ خرید تأییدشده")).toContainText("میانگین ۴ از ۵");

    await page.goto(
      `/purchase-experiences/new?${new URLSearchParams({ orderItemId, returnTo })}`,
    );
    await expect(
      page.getByText("برای این خرید قبلاً یک تجربه ثبت شده است."),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .getByRole("link", { name: "بازگشت" })
        .evaluate((element) => getComputedStyle(element).animationDuration),
    ).toBe("0s");
  } finally {
    const [experience] = await sql<Array<{ id: string }>>`
      select id from content_purchase_experiences where order_item_id = ${orderItemId}
    `;
    if (experience) {
      await sql`delete from platform_outbox_events where aggregate_id = ${experience.id}`;
      await sql`delete from content_audits where aggregate_id = ${experience.id}`;
    }
    await sql`delete from content_idempotency_records where actor_id in (
      select identity_id from identity_login_methods where mobile = ${mobile}
    )`;
    await sql`delete from content_purchase_experiences where buyer_identity_id in (
      select identity_id from identity_login_methods where mobile = ${mobile}
    )`;
    if (orderCreated) {
      await sql`delete from order_items where order_id = ${orderId}`;
      await sql`delete from order_orders where id = ${orderId}`;
      await sql`delete from order_checkout_preparations where checkout_revision = ${checkoutId}`;
      await sql`delete from order_carts where id = ${cartId}`;
    }
    await sql`delete from inventory_levels where variant_id = ${variantId}`;
    await sql`delete from product_offers where product_id = ${productId}`;
    await sql`delete from product_publications where product_id = ${productId}`;
    await sql`delete from product_variants where product_id = ${productId}`;
    await sql`delete from product_products where id = ${productId}`;
    await sql`delete from store_shipping_methods where store_id = ${storeId}`;
    await sql`delete from store_memberships where store_id = ${storeId}`;
    await sql`delete from store_stores where id = ${storeId}`;
    await sql.end();
  }
});
