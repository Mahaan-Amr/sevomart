import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

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
  const orderIds = [randomUUID(), randomUUID(), randomUUID()] as const;

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/seller/login");
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();

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
    const reportsLink = page.getByRole("link", { name: "دیدن گزارش فروش" });
    await expect(reportsLink).toHaveAttribute("href", "/seller/reports");
    await assertNoHorizontalOverflow(page);
    await assertInteractiveTargets(
      page,
      "main a, main button, main input, main select, main summary, main textarea",
    );
    await assertMinimumContrast(reportsLink);

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
    await assertInteractiveTargets(
      page,
      "main a, main button, main input, main select, main summary, main textarea",
    );

    await sql`delete from reporting_fulfillment_states where order_id in ${sql(orderIds)}`;
    await sql`delete from reporting_seller_order_facts where store_id = ${storeId}`;
    await page.reload();
    await expect(page.getByText("در این بازه سفارشی ثبت نشده است.")).toBeVisible();
  } finally {
    await sql`delete from reporting_fulfillment_states where order_id in ${sql(orderIds)}`;
    await sql`delete from reporting_seller_order_facts where store_id = ${storeId}`;
    await sql`delete from store_memberships where store_id = ${storeId}`;
    await sql`delete from store_stores where id = ${storeId}`;
    await sql`delete from identity_seller_access where identity_id = ${identityId}`;
    await sql.end();
  }
});
