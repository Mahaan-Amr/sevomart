import { createHmac, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { expect, test } from "../helpers/release-playwright";
import postgres from "postgres";

import {
  e2eApiBaseUrl,
  paymentBuyerTestMobiles,
  paymentSellerTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";
import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";

test("buyer dispatches payment, confirms once, and sees the real receipt", async ({
  browser,
  page,
}, testInfo) => {
  const mobile = paymentBuyerTestMobiles[visualProjectIndex(testInfo.project.name)]!;
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  const ids = {
    cart: randomUUID(),
    checkout: randomUUID(),
    order: randomUUID(),
    reservation: randomUUID(),
    store: randomUUID(),
    variant: randomUUID(),
    product: randomUUID(),
    shipping: randomUUID(),
  };
  let createdAttemptId: string | undefined;
  const reviewSnapshot = {
    checkoutRevision: ids.checkout,
    expiresAt: "2026-08-24T20:10:00.000Z",
    cart: { cartId: ids.cart, revision: 1 },
    store: { storeId: ids.store, name: "خانه فنجان" },
    items: [
      {
        productId: ids.product,
        variantId: ids.variant,
        name: "فنجان سرامیکی با نام بلند برای بررسی چیدمان فارسی",
        quantity: 1,
        publicationVersion: 1,
        unitPrice: { amount: 4_500_000, currency: "IRR" },
        lineTotal: { amount: 4_500_000, currency: "IRR" },
      },
    ],
    shippingMethod: {
      id: ids.shipping,
      revision: 1,
      code: "PICKUP",
      label: "تحویل حضوری",
      fee: { amount: 0, currency: "IRR" },
      estimatedDeliveryText: "هماهنگی با فروشگاه",
      requiresDeliveryAddress: false,
    },
    returnPolicy: {
      revision: 1,
      text: "تا هفت روز امکان درخواست مرجوعی دارید و فروشگاه نتیجه بررسی را اعلام می‌کند.",
    },
    subtotal: { amount: 4_500_000, currency: "IRR" },
    total: { amount: 4_500_000, currency: "IRR" },
    settlement: {
      mode: "DIRECT",
      disclosure:
        "مبلغ این سفارش مستقیماً برای فروشگاه تسویه می‌شود. سیاست مرجوعی را فروشگاه تعیین می‌کند. سوو گزارش مشکل و تخلف را پیگیری می‌کند، اما بازپرداخت را تضمین نمی‌کند.",
    },
  };
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login?next=/");
    await page.getByLabel("شماره موبایل").fill(mobile);
    await page.getByRole("button", { name: "دریافت کد" }).click();
    await page.getByLabel("کد شش‌رقمی").fill("111111");
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login")),
      page.getByRole("button", { name: "ورود" }).click(),
    ]);
    const identities = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId" from identity_login_methods where mobile = ${mobile}
    `;
    const identityId = identities[0]?.identityId;
    if (!identityId) throw new Error("Buyer login did not create an identity");
    await sql`insert into inventory_levels (variant_id, store_id, on_hand, revision) values (${ids.variant}, ${ids.store}, 2, 1)`;
    await sql`insert into order_carts (id, store_id, identity_id, status, revision, expires_at) values (${ids.cart}, ${ids.store}, ${identityId}, 'CONVERTED', 1, now() + interval '1 day')`;
    await sql`insert into order_checkout_preparations (checkout_revision, identity_id, cart_id, cart_revision, shipping_method_id, shipping_revision, policy_revision, snapshot, expires_at) values (${ids.checkout}, ${identityId}, ${ids.cart}, 1, ${ids.shipping}, 1, 1, '{}', now() + interval '1 day')`;
    await sql`insert into order_orders (id, identity_id, store_id, checkout_revision, reservation_id, status, total_amount, currency, reservation_expires_at, review_snapshot) values (${ids.order}, ${identityId}, ${ids.store}, ${ids.checkout}, ${ids.reservation}, 'PENDING_PAYMENT', 4500000, 'IRR', now() + interval '15 minutes', ${sql.json(reviewSnapshot)})`;
    await sql`insert into order_items (order_id, variant_id, product_id, name, quantity, unit_price_amount, publication_version) values (${ids.order}, ${ids.variant}, ${ids.product}, 'فنجان سرامیکی', 1, 4500000, 1)`;
    await sql`insert into inventory_reservations (id, order_id, store_id, status, expires_at) values (${ids.reservation}, ${ids.order}, ${ids.store}, 'ACTIVE', now() + interval '15 minutes')`;
    await sql`insert into inventory_reservation_lines (reservation_id, variant_id, quantity) values (${ids.reservation}, ${ids.variant}, 1)`;

    const dispatched = await page
      .context()
      .request.post(`/api/orders/${ids.order}/payment-attempts`, {
        headers: { "idempotency-key": `e2e-${ids.order}` },
        data: {},
      });
    expect(dispatched.status()).toBe(201);
    const attempt = (await dispatched.json()) as {
      attemptId: string;
      orderId: string;
      amount: { amount: number };
      status: string;
    };
    createdAttemptId = attempt.attemptId;
    expect(attempt).toMatchObject({ orderId: ids.order, status: "DISPATCHED" });

    const unsigned = {
      attemptId: attempt.attemptId,
      orderId: ids.order,
      amount: attempt.amount.amount,
      result: "CONFIRMED" as const,
      providerEventId: `e2e-${attempt.attemptId}`,
    };
    const signature = createHmac("sha256", "sevo-local-dev-payment-fixture-secret")
      .update(Object.values(unsigned).join("."))
      .digest("hex");
    const callbackBody = { ...unsigned, signature };
    const callbackUrl = `${e2eApiBaseUrl()}/internal/v1/payment-providers/DEV/callbacks`;
    const confirmed = await page.context().request.post(callbackUrl, {
      data: callbackBody,
    });
    expect(await confirmed.json()).toMatchObject({
      attemptId: attempt.attemptId,
      duplicate: false,
    });
    const duplicate = await page.context().request.post(callbackUrl, {
      data: callbackBody,
    });
    expect(await duplicate.json()).toMatchObject({
      attemptId: attempt.attemptId,
      duplicate: true,
    });

    await page.goto(`/orders/${ids.order}?attemptId=${attempt.attemptId}`);
    await expect(page).toHaveURL(
      new RegExp(
        `/orders/${ids.order}/payment-result\\?attemptId=${attempt.attemptId}$`,
      ),
    );
    await expect(page.getByRole("heading", { name: "پرداخت تأیید شد" })).toBeVisible();
    const ownerRead = await page.context().request.get(`/api/orders/${ids.order}`);
    expect(ownerRead.status()).toBe(200);
    expect(ownerRead.headers()["cache-control"]).toBe("no-store");
    await expect(page.getByText("تسویه مستقیم با فروشگاه")).toBeVisible();
    await expect(page.getByText("زمان پرداخت")).toBeVisible();
    await expect(
      page.getByText("قدم بعدی: فروشگاه سفارش را آماده می‌کند."),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await page.goto("/orders");
    await expect(page.getByRole("heading", { name: "سفارش‌های من" })).toBeVisible();
    await expect(page.getByText("خانه فنجان")).toBeVisible();
    await page.getByRole("link", { name: /خانه فنجان/ }).click();
    await expect(page).toHaveURL(`/orders/${ids.order}`);
    await expect(page.getByRole("heading", { name: "پرداخت تأیید شد" })).toBeVisible();
    await expect(page.getByText("سیاست مرجوعی ثبت‌شده هنگام سفارش")).toBeVisible();
    await expect(page.getByText("تسویه مستقیم با فروشگاه")).toBeVisible();
    await expect(
      page.getByText("برای این سفارش پرونده اختلافی ثبت نشده است."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "پرداخت تأیید شد" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await assertMinimumContrast(page.locator("main h1, main h2, main p, main a"));
    const back = page.getByRole("link", { name: "همه سفارش‌ها" });
    await focusByTab(page, back);
    await expect(back).toHaveCSS("outline-style", "solid");
    expect(
      await page
        .locator("article")
        .evaluate(
          (element) =>
            Number.parseFloat(getComputedStyle(element).transitionDuration) || 0,
        ),
    ).toBeLessThanOrEqual(0.01);
    await mkdir("docs/delivery/issue-148", { recursive: true });
    await page.screenshot({
      path: `docs/delivery/issue-148/order-tracking-${testInfo.project.name}.png`,
      fullPage: true,
    });
    expect(
      await sql`select count(*)::int as count from payment_attempts where order_id = ${ids.order}`,
    ).toEqual([{ count: 1 }]);

    const unrelatedContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      locale: "fa-IR",
      timezoneId: "Asia/Tehran",
    });
    const unrelatedPage = await unrelatedContext.newPage();
    try {
      await unrelatedPage.goto("/login?next=/");
      await unrelatedPage
        .getByLabel("شماره موبایل")
        .fill(paymentSellerTestMobiles[visualProjectIndex(testInfo.project.name)]!);
      await unrelatedPage.getByRole("button", { name: "دریافت کد" }).click();
      await unrelatedPage.getByLabel("کد شش‌رقمی").fill("111111");
      await Promise.all([
        unrelatedPage.waitForURL((url) => !url.pathname.startsWith("/login")),
        unrelatedPage.getByRole("button", { name: "ورود" }).click(),
      ]);
      await unrelatedPage.goto(`/orders/${ids.order}`);
      await expect(
        unrelatedPage.getByText("این سفارش پیدا نشد یا به هویت سوو شما تعلق ندارد."),
      ).toBeVisible();
    } finally {
      await unrelatedContext.close();
    }
  } finally {
    if (createdAttemptId) {
      await sql`delete from payment_attempt_audits where attempt_id = ${createdAttemptId}`;
      await sql`delete from payment_provider_observations where attempt_id = ${createdAttemptId}`;
      await sql`delete from payment_idempotency_records where attempt_id = ${createdAttemptId}`;
      await sql`delete from payment_attempts where id = ${createdAttemptId}`;
    }
    await sql`delete from order_state_transitions where order_id = ${ids.order}`;
    await sql`delete from platform_outbox_events where aggregate_id in (${ids.order}, ${createdAttemptId ?? ids.order})`;
    await sql`delete from inventory_reservation_lines where reservation_id = ${ids.reservation}`;
    await sql`delete from inventory_reservations where id = ${ids.reservation}`;
    await sql`delete from order_items where order_id = ${ids.order}`;
    await sql`delete from order_orders where id = ${ids.order}`;
    await sql`delete from order_checkout_preparations where checkout_revision = ${ids.checkout}`;
    await sql`delete from order_carts where id = ${ids.cart}`;
    await sql`delete from inventory_levels where variant_id = ${ids.variant}`;
    await sql.end();
  }
});

async function focusByTab(
  page: import("@playwright/test").Page,
  target: import("@playwright/test").Locator,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Target was not reachable by keyboard");
}

test("seller sees the real paid actionable order", async ({ page }, testInfo) => {
  const mobile = paymentSellerTestMobiles[visualProjectIndex(testInfo.project.name)]!;
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  const ids = {
    store: randomUUID(),
    membership: randomUUID(),
    cart: randomUUID(),
    checkout: randomUUID(),
    order: randomUUID(),
    reservation: randomUUID(),
    variant: randomUUID(),
    product: randomUUID(),
    shipping: randomUUID(),
  };
  try {
    await page.goto("/seller/login?returnTo=%2Fseller%2Forders");
    await page.getByLabel("شماره موبایل").fill(mobile);
    await page.getByRole("button", { name: "دریافت کد" }).click();
    await page.getByLabel("کد شش‌رقمی").fill("111111");
    await page.getByRole("button", { name: "ورود" }).click();
    await expect(page.getByRole("heading", { name: "وارد شدید" })).toBeVisible();
    const identities = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId" from identity_login_methods where mobile = ${mobile}
    `;
    const identityId = identities[0]?.identityId;
    if (!identityId) throw new Error("Seller login did not create an identity");
    await sql`insert into identity_seller_access (id, identity_id, status) values (${randomUUID()}, ${identityId}, 'ACTIVE') on conflict (identity_id) do update set status = 'ACTIVE'`;
    await sql`insert into store_stores (id, name, slug, status, revision) values (${ids.store}, 'خانه فنجان', ${`payment-${ids.store}`}, 'PUBLISHED', 1)`;
    await sql`insert into store_memberships (id, store_id, seller_id, role) values (${ids.membership}, ${ids.store}, ${identityId}, 'OWNER')`;
    await sql`insert into order_carts (id, store_id, identity_id, status, revision, expires_at) values (${ids.cart}, ${ids.store}, ${identityId}, 'CONVERTED', 1, now() + interval '1 day')`;
    await sql`insert into order_checkout_preparations (checkout_revision, identity_id, cart_id, cart_revision, shipping_method_id, shipping_revision, policy_revision, snapshot, expires_at) values (${ids.checkout}, ${identityId}, ${ids.cart}, 1, ${ids.shipping}, 1, 1, '{}', now() + interval '1 day')`;
    await sql`insert into order_orders (id, identity_id, store_id, checkout_revision, reservation_id, status, total_amount, currency, reservation_expires_at, review_snapshot, paid_at) values (${ids.order}, ${identityId}, ${ids.store}, ${ids.checkout}, ${ids.reservation}, 'PAID', 4500000, 'IRR', now() + interval '15 minutes', '{}', now())`;
    await sql`insert into order_items (order_id, variant_id, product_id, name, quantity, unit_price_amount, publication_version) values (${ids.order}, ${ids.variant}, ${ids.product}, 'فنجان سرامیکی', 1, 4500000, 1)`;

    await page.goto("/seller/orders");
    await expect(
      page.getByRole("heading", { name: "سفارش‌های آماده اقدام" }),
    ).toBeVisible();
    await expect(page.getByText(`سفارش ${ids.order}`)).toBeVisible();
    await expect(page.getByText("۱ کالا")).toBeVisible();
  } finally {
    await sql`delete from order_items where order_id = ${ids.order}`;
    await sql`delete from order_orders where id = ${ids.order}`;
    await sql`delete from order_checkout_preparations where checkout_revision = ${ids.checkout}`;
    await sql`delete from order_carts where id = ${ids.cart}`;
    await sql`delete from store_memberships where id = ${ids.membership}`;
    await sql`delete from store_stores where id = ${ids.store}`;
    await sql.end();
  }
});
