import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  sellerRefundTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("seller requests cancellation while refund stays pending trusted verification", async ({
  page,
}, testInfo) => {
  const index = visualProjectIndex(testInfo.project.name);
  const mobile = sellerRefundTestMobiles[index]!;
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  const storeId = randomUUID();
  const orderId = randomUUID();
  const attemptId = randomUUID();
  let requestSubmitted = false;

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
  if (!identityId) throw new Error("refund seller identity was not created");
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
        (${storeId}, 'خانه بازپرداخت', ${`refund-${index}`}, 'فروشگاه آزمون',
         'بازگشت کالا پس از هماهنگی بررسی می‌شود.', 1, 'TEST', 'TEST_VERIFIED',
         now(), '#A41439', 'PUBLISHED', now(), 1, 1)
    `;
    await transaction`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${randomUUID()}, ${storeId}, ${identityId}, 'OWNER')
    `;
  });

  await page.route(`**/api/seller/orders/${orderId}/direct-refund`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(
        requestSubmitted
          ? {
              status: 200,
              json: {
                orderId,
                paymentAttemptId: attemptId,
                amount: { amount: 12_500_000, currency: "IRR" },
                status: "CONFIRMED",
                orderStatus: "CANCELLED",
                nextAction: "NONE",
                updatedAt: "2026-08-31T08:05:00.000Z",
              },
            }
          : { status: 404, json: { code: "REFUND_NOT_FOUND" } },
      );
      return;
    }
    requestSubmitted = true;
    await route.fulfill({
      status: 200,
      json: {
        orderId,
        paymentAttemptId: attemptId,
        amount: { amount: 12_500_000, currency: "IRR" },
        status: "PENDING",
        orderStatus: "CANCELLATION_PENDING_REFUND",
        nextAction: "WAIT_FOR_VERIFICATION",
        updatedAt: "2026-08-31T08:00:00.000Z",
      },
    });
  });

  try {
    await page.goto(`/seller/orders/${orderId}/refund`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { name: "لغو و پیگیری بازپرداخت" }),
    ).toBeVisible();
    await expect(page.getByText(/بازپرداخت را تضمین نمی‌کند/)).toBeVisible();
    await page
      .getByLabel("دلیل لغو پیش از ارسال")
      .fill(
        "این توضیح بلند فارسی برای بررسی نمایش متن در موبایل و دسکتاپ است و روشن می‌کند کالا پیش از ارسال قابل تأمین نیست.",
      );
    const submit = page.getByRole("button", {
      name: "ثبت درخواست لغو و بررسی بازپرداخت",
    });
    await assertInteractiveTargets(submit);
    await assertMinimumContrast(submit);
    await submit.click();
    const result = page.getByRole("heading", {
      name: "لغو در انتظار تأیید بازپرداخت است",
    });
    await expect(result).toBeFocused();
    await expect(page.getByText("لغو در انتظار بازپرداخت")).toBeVisible();
    const confirmed = page.getByRole("heading", {
      name: "بازپرداخت تأیید و سفارش لغو شد",
    });
    await expect(confirmed).toBeFocused({ timeout: 7_000 });
    await expect(page.getByText("لغوشده")).toBeVisible();
    await assertNoHorizontalOverflow(page);
  } finally {
    await sql`delete from store_memberships where store_id = ${storeId}`;
    await sql`delete from store_stores where id = ${storeId}`;
    await sql`delete from identity_seller_access where identity_id = ${identityId}`;
    await sql.end();
  }
});
