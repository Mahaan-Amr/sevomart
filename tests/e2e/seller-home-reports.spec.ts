import { randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "../helpers/release-playwright";
import postgres from "postgres";
import { captureReleaseCheckpoint } from "../helpers/release-checkpoint";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  sellerReportsTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("seller acts from the operational home and reads a private basic report", async ({
  page,
}, testInfo) => {
  const projectIndex = visualProjectIndex(testInfo.project.name);
  const mobile = sellerReportsTestMobiles[projectIndex]!;
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  const storeId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const mediaId = randomUUID();
  const orderIds = [randomUUID(), randomUUID(), randomUUID()] as const;

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/seller/login");
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByRole("link", { name: "ادامه کار" })).toBeVisible();

  const identities = await sql<Array<{ identityId: string }>>`
    select identity_id as "identityId"
    from identity_login_methods
    where mobile = ${mobile}
  `;
  const identityId = identities[0]?.identityId;
  if (!identityId) throw new Error("seller report identity was not created");

  await sql.begin(async (transaction) => {
    await transaction`
      delete from store_stores where id in (
        select store_id from store_memberships where seller_id = ${identityId}::uuid
      )
    `;
    await transaction`
      insert into identity_seller_access (id, identity_id, status)
      values (${randomUUID()}, ${identityId}, 'ACTIVE')
      on conflict (identity_id) do update set status = 'ACTIVE'
    `;
    await transaction`
      insert into store_stores (id, name, slug, status, revision)
      values (${storeId}, 'خانه گزارش', ${`reports-${projectIndex}`}, 'PUBLISHED', 1)
    `;
    await transaction`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${randomUUID()}, ${storeId}, ${identityId}, 'OWNER')
    `;
    await transaction`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at)
      values (${productId}, ${storeId}, 'PUBLISHED', 1, 1, now())
    `;
    await transaction`
      insert into product_variants
        (id, product_id, store_id, client_key, combination_key, retired,
         ever_published)
      values (${variantId}, ${productId}, ${storeId}, 'simple', '', false, true)
    `;
    await transaction`
      insert into product_publications
        (product_id, publication_version, name, description, media_id, variant_id)
      values (${productId}, 1,
        'کالای دست‌ساز',
        'شرح کالای آزمون', ${mediaId}, ${variantId})
    `;
    await transaction`
      insert into product_offers (product_id, variant_id, amount, currency, revision)
      values (${productId}, ${variantId}, 1000000, 'IRR', 1)
    `;
    await transaction`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${variantId}, ${storeId}, 0, 1)
    `;
    await transaction`
      insert into reporting_seller_order_facts
        (order_id, store_id, total_amount, currency, paid_at,
         aggregate_version, last_event_id, projected_at)
      values
        (${orderIds[0]}, ${storeId}, 1000000, 'IRR', now() - interval '2 days',
         1, ${randomUUID()}, now()),
        (${orderIds[1]}, ${storeId}, 2000000, 'IRR', now() - interval '3 days',
         1, ${randomUUID()}, now()),
        (${orderIds[2]}, ${storeId}, 3000000, 'IRR', now() - interval '4 days',
         1, ${randomUUID()}, now())
    `;
    await transaction`
      insert into reporting_fulfillment_states
        (order_id, status, aggregate_version, last_event_id, occurred_at, projected_at)
      values
        (${orderIds[1]}, 'PREPARING', 2, ${randomUUID()},
         now() - interval '30 hours', now()),
        (${orderIds[2]}, 'DELIVERED', 3, ${randomUUID()},
         now() - interval '1 day', now())
    `;
  });

  try {
    await page.goto("/seller");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "کارهای نزدیک" })).toBeVisible();
    await expect(page.getByText("۱ سفارش تازه آماده رسیدگی است")).toBeVisible();
    await expect(
      page.getByText("۱ سفارش بیش از ۲۴ ساعت در حال آماده‌سازی است"),
    ).toBeVisible();
    await expect(
      page.getByText(/وضعیت آماده‌سازی این سفارش‌ها را بررسی کنید/),
    ).toBeVisible();
    await expect(page.getByText("۱ گونه کالا موجودی ندارد")).toBeVisible();
    const reportsLink = page.getByRole("link", { name: "دیدن گزارش فروش" });
    await expect(reportsLink).toHaveAttribute("href", "/seller/reports");
    await assertNoHorizontalOverflow(page);
    await captureReleaseCheckpoint(page, testInfo, {
      cellId: "seller-home-reporting:success",
      name: "seller-home",
      sensitiveRegions: [],
    });
    await assertInteractiveTargets(
      page,
      "main a, main button, main input, main select, main summary, main textarea",
    );
    await assertMinimumContrast(reportsLink);

    await expectKeyboardFocus(page, reportsLink, 14);

    const preparingOrderId = randomUUID();
    const freshOrderId = randomUUID();
    await page.route("**/api/seller/orders", (route) =>
      route.fulfill({
        status: 200,
        json: {
          orders: [actionableOrder(preparingOrderId), actionableOrder(freshOrderId)],
        },
      }),
    );
    await page.route("**/api/seller/orders/*/fulfillment", (route) => {
      const orderId = route.request().url().split("/").at(-2);
      return route.fulfill({
        status: 200,
        json: fulfillmentTimeline(orderId!, {
          status: "PREPARING",
          hoursAgo: orderId === preparingOrderId ? 30 : 2,
        }),
      });
    });
    await page.getByRole("link", { name: "بررسی آماده‌سازی‌ها" }).click();
    await expect(page).toHaveURL(/\/seller\/orders\?status=preparing$/);
    await expect(
      page.getByRole("heading", { name: "آماده‌سازی‌های بیشتر از ۲۴ ساعت" }),
    ).toBeVisible();
    await expect(page.getByText(`سفارش ${preparingOrderId}`)).toBeVisible();
    await expect(page.getByText(`سفارش ${freshOrderId}`)).toHaveCount(0);

    await page.goto("/seller");

    await reportsLink.click();
    await expect(page).toHaveURL(/\/seller\/reports$/);
    await expect(page.getByRole("heading", { name: "گزارش فروش" })).toBeVisible();
    await expect(page.getByText("۳۰ روز گذشته")).toBeVisible();
    await expect(page.getByText("۶۰۰٬۰۰۰ تومان")).toBeVisible();
    await expect(page.getByText("۳", { exact: true })).toBeVisible();
    await expect(page.getByText("۱", { exact: true })).toBeVisible();
    await expect(page.getByText("از", { exact: true })).toBeVisible();
    await expect(page.getByText("تا", { exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await captureReleaseCheckpoint(page, testInfo, {
      cellId: "seller-home-reporting:success",
      name: "seller-report",
      sensitiveRegions: [],
    });
    await assertInteractiveTargets(
      page,
      "main a, main button, main input, main select, main summary, main textarea",
    );
    const backLink = page.getByRole("link", { name: "بازگشت به کارهای نزدیک" });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expectKeyboardFocus(page, backLink, 12);

    await sql`delete from reporting_fulfillment_states where order_id in ${sql(orderIds)}`;
    await sql`delete from reporting_seller_order_facts where store_id = ${storeId}`;
    await page.reload();
    await expect(page.getByText("در این بازه سفارشی ثبت نشده است.")).toBeVisible();
  } finally {
    await sql`delete from reporting_fulfillment_states where order_id in ${sql(orderIds)}`;
    await sql`delete from reporting_seller_order_facts where store_id = ${storeId}`;
    await sql`delete from inventory_levels where variant_id = ${variantId}`;
    await sql`delete from product_products where id = ${productId}`;
    await sql`delete from store_memberships where store_id = ${storeId}`;
    await sql`delete from store_stores where id = ${storeId}`;
    await sql`delete from identity_seller_access where identity_id = ${identityId}`;
    await sql.end();
  }
});

function actionableOrder(orderId: string) {
  return {
    orderId,
    status: "PAID",
    total: { amount: 1_000_000, currency: "IRR" },
    paidAt: "2026-08-30T08:00:00.000Z",
    createdAt: "2026-08-30T07:55:00.000Z",
    itemCount: 1,
  };
}

function fulfillmentTimeline(
  orderId: string,
  input: { status: "PREPARING"; hoursAgo: number },
) {
  const occurredAt = new Date(
    Date.now() - input.hoursAgo * 60 * 60 * 1_000,
  ).toISOString();
  return {
    orderId,
    status: input.status,
    nextStatus: "SHIPPED",
    timeline: [
      {
        status: input.status,
        actor: { type: "SYSTEM" },
        occurredAt,
        correlationId: randomUUID(),
      },
    ],
  };
}

async function expectKeyboardFocus(page: Page, target: Locator, maxTabs: number) {
  for (let attempt = 0; attempt < maxTabs; attempt += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
  await expect(target).toHaveCSS("outline-style", "solid");
}
