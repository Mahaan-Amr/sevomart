import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import { sellerBuyerTestMobiles, visualProjectIndex } from "../helpers/visual-projects";

test("seller finds an order buyer and reveals delivery details with a reason", async ({
  page,
}, testInfo) => {
  const index = visualProjectIndex(testInfo.project.name);
  const mobile = sellerBuyerTestMobiles[index]!;
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  const storeId = randomUUID();
  const orderId = randomUUID();
  const olderOrderId = randomUUID();
  const pendingOrderId = randomUUID();
  const buyerId = randomUUID();
  let revealReason: string | undefined;

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/seller/login");
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();

  const identities = await sql<Array<{ identityId: string }>>`
    select identity_id as "identityId" from identity_login_methods where mobile = ${mobile}
  `;
  const identityId = identities[0]?.identityId;
  if (!identityId) throw new Error("related buyers seller identity was not created");
  await sql.begin(async (transaction) => {
    await transaction`
      insert into identity_seller_access (id, identity_id, status)
      values (${randomUUID()}, ${identityId}, 'ACTIVE')
      on conflict (identity_id) do update set status = 'ACTIVE'
    `;
    await transaction`
      insert into store_stores
        (id, name, slug, bio, return_policy, return_policy_revision,
         settlement_kind, settlement_status, settlement_verified_at,
         theme_color, status, published_at, publication_version, revision)
      values
        (${storeId}, 'خانه خریداران', ${`buyers-${index}`}, 'فروشگاه آزمون',
         'بازگشت کالا پس از هماهنگی بررسی می‌شود.', 1, 'TEST', 'TEST_VERIFIED',
         now(), '#A41439', 'PUBLISHED', now(), 1, 1)
    `;
    await transaction`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${randomUUID()}, ${storeId}, ${identityId}, 'OWNER')
    `;
  });

  const buyerPage = {
    items: [
      {
        buyerId,
        displayName: "سارا ا.",
        maskedMobile: "0912••••789",
        orderCount: 2,
        matchedOrderId: orderId,
        latestOrder: {
          orderId,
          paymentStatus: "PAID",
          fulfillmentStatus: "DELIVERED",
          createdAt: "2026-08-31T08:00:00.000Z",
        },
      },
    ],
    nextCursor: null,
  };

  await page.route("**/api/seller/orders", (route) =>
    route.fulfill({ status: 200, json: { orders: [] } }),
  );
  await page.route("**/api/seller/buyers**", (route) => {
    const search = new URL(route.request().url()).searchParams.get("search");
    const matchedOrderId = search === olderOrderId ? olderOrderId : orderId;
    return route.fulfill({
      status: 200,
      json: {
        ...buyerPage,
        items: [{ ...buyerPage.items[0], matchedOrderId }],
      },
    });
  });
  await page.route("**/api/seller/orders/*/buyer-orders**", (route) => {
    const contextualOrderId = route
      .request()
      .url()
      .split("/buyer-orders")[0]
      ?.split("/")
      .at(-1);
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({
      status: 200,
      headers: { "cache-control": "no-store" },
      json:
        contextualOrderId === olderOrderId
          ? {
              items: [
                {
                  orderId: olderOrderId,
                  paymentStatus: "CANCELLED",
                  fulfillmentStatus: "CANCELLED",
                  createdAt: "2026-08-20T07:30:00.000Z",
                },
              ],
              nextCursor: null,
            }
          : cursor === "history-next"
            ? {
                items: [
                  {
                    orderId: olderOrderId,
                    paymentStatus: "CANCELLED",
                    fulfillmentStatus: "CANCELLED",
                    createdAt: "2026-08-20T07:30:00.000Z",
                  },
                  {
                    orderId: pendingOrderId,
                    paymentStatus: "PENDING_PAYMENT",
                    createdAt: "2026-08-19T07:30:00.000Z",
                  },
                ],
                nextCursor: null,
              }
            : {
                items: [
                  {
                    orderId,
                    paymentStatus: "PAID",
                    fulfillmentStatus: "DELIVERED",
                    createdAt: "2026-08-31T08:00:00.000Z",
                  },
                ],
                nextCursor: "history-next",
              },
    });
  });
  await page.route(
    `**/api/seller/orders/${orderId}/delivery-details/reveal`,
    async (route) => {
      const payload = route.request().postDataJSON() as { reason: string };
      revealReason = payload.reason;
      await route.fulfill({
        status: 200,
        headers: { "cache-control": "no-store" },
        json: {
          orderId,
          recipientName: "سارا احمدی",
          recipientMobile: "09123456789",
          address: {
            provinceText: "تهران",
            cityText: "تهران",
            addressLine:
              "خیابان آزادی، کوچه بهار، پلاک ۱۲، واحد ۳؛ توضیح بلند برای بررسی نمایش در موبایل",
            postalCode: "1234567890",
          },
          fulfillmentStatus: "DELIVERED",
          revealedAt: "2026-08-31T08:05:00.000Z",
        },
      });
    },
  );

  try {
    await page.goto("/seller/orders");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const buyerSearchEntry = page.getByRole("link", {
      name: "پیدا کردن خریدار یک سفارش",
    });
    await buyerSearchEntry.focus();
    await expect(buyerSearchEntry).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/seller/orders/buyers");
    const searchInput = page.getByLabel("نام خریدار یا شماره سفارش");
    await searchInput.fill("سارا");
    await expect(searchInput).toHaveCSS("outline-style", "solid");
    const search = page.getByRole("button", { name: "پیدا کردن خریدار" });
    await assertInteractiveTargets(search);
    await assertMinimumContrast(search);
    await page.keyboard.press("Enter");
    await expect(page.getByText("0912••••789")).toBeVisible();
    await expect(page.getByText(orderId)).toBeVisible();
    await expect(page.getByText("تحویل‌شده")).toBeVisible();
    const contextualBuyer = page.getByRole("link", {
      name: "دیدن خریدار در سفارش",
    });
    await contextualBuyer.focus();
    await expect(contextualBuyer).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(`/seller/orders/${orderId}/buyer`);
    await expect(page.getByRole("heading", { name: "خریدار این سفارش" })).toBeVisible();
    await expect(page.getByText("شماره تماس و نشانی فعلاً ماسک‌اند")).toBeVisible();
    await expect(page.getByText("0912••••789")).toBeVisible();
    const historySection = page
      .getByRole("heading", { name: "تاریخچه سفارش‌های همین فروشگاه" })
      .locator("../..");
    await expect(historySection).toBeVisible();
    await expect(historySection.getByText("سفارش فعلی")).toBeVisible();
    await expect(historySection.getByText(orderId, { exact: true })).toBeVisible();
    const moreHistory = historySection.getByRole("button", {
      name: "نمایش سفارش‌های بیشتر",
    });
    await assertInteractiveTargets(moreHistory);
    await moreHistory.focus();
    await expect(moreHistory).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    const olderOrder = historySection.getByRole("link", {
      name: new RegExp(olderOrderId),
    });
    await expect(olderOrder).toBeVisible();
    await expect(historySection.getByText("لغوشده").first()).toBeVisible();
    const pendingOrder = historySection.getByRole("listitem").filter({
      hasText: pendingOrderId,
    });
    await expect(pendingOrder.getByText("در انتظار پرداخت")).toBeVisible();
    await expect(pendingOrder.getByText("هنوز شروع نشده")).toBeVisible();
    const reason = page.getByLabel("دلیل مشاهده شماره و نشانی");
    await reason.fill("پیگیری ارسال سفارش و هماهنگی زمان تحویل");
    const reveal = page.getByRole("button", { name: "نمایش اطلاعات تحویل" });
    await assertInteractiveTargets(reveal);
    await assertMinimumContrast(reveal);
    const reducedDuration = await reveal.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).transitionDuration),
    );
    expect(reducedDuration).toBeLessThan(0.001);
    await page.keyboard.press("Tab");
    await expect(reveal).toBeFocused();
    await page.keyboard.press("Enter");

    const revealedHeading = page.getByRole("heading", {
      name: "اطلاعات تحویل برای این پیگیری",
    });
    await expect(revealedHeading).toBeFocused();
    await expect(page.getByText("09123456789")).toBeVisible();
    await expect(page.getByText(/خیابان آزادی/)).toBeVisible();
    expect(revealReason).toBe("پیگیری ارسال سفارش و هماهنگی زمان تحویل");
    await assertNoHorizontalOverflow(page);
    await olderOrder.click();
    await expect(page).toHaveURL(`/seller/orders/${olderOrderId}/buyer`);
    await expect(page.getByRole("heading", { name: "خریدار این سفارش" })).toBeVisible();
    await expect(page.getByText("0912••••789")).toBeVisible();
    await expect(page.getByText("خریدار این سفارش پیدا نشد.")).toHaveCount(0);
    const destinationHistory = page
      .getByRole("heading", { name: "تاریخچه سفارش‌های همین فروشگاه" })
      .locator("../..");
    await expect(destinationHistory.getByText("سفارش فعلی")).toBeVisible();
  } finally {
    await sql`delete from store_memberships where store_id = ${storeId}`;
    await sql`delete from store_stores where id = ${storeId}`;
    await sql`delete from identity_seller_access where identity_id = ${identityId}`;
    await sql.end();
  }
});
