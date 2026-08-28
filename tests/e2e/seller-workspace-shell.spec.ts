import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  sellerWorkspaceTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("active seller gets the canonical shell and loses it after a live suspension", async ({
  page,
}, testInfo) => {
  const mobile = sellerWorkspaceTestMobiles[visualProjectIndex(testInfo.project.name)]!;
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });

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
  if (!identityId) throw new Error("seller workspace identity was not created");
  const applicationId = randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      delete from identity_seller_access where identity_id = ${identityId}
    `;
    await transaction`
      delete from identity_seller_application_revisions
      where application_id in (
        select id from identity_seller_applications where identity_id = ${identityId}
      )
    `;
    await transaction`
      delete from identity_seller_applications where identity_id = ${identityId}
    `;
    await transaction`
      insert into identity_seller_applications
        (id, identity_id, status, current_revision, aggregate_version,
         created_at, last_submitted_at, completed_at)
      values (${applicationId}, ${identityId}, 'APPROVED', 1, 1, now(), now(), now())
    `;
    await transaction`
      insert into identity_seller_application_revisions
        (id, application_id, revision, applicant_name, proposed_store_name,
         goods_area_text, current_sales_method, submitted_at)
      values (${randomUUID()}, ${applicationId}, 1, 'نگار محمدی', 'خانه ماه',
        'سفال دست‌ساز', 'فروش از راه شبکه اجتماعی', now())
    `;
    await transaction`
      insert into identity_seller_access (id, identity_id, status)
      values (${randomUUID()}, ${identityId}, 'ACTIVE')
    `;
  });

  await page.getByRole("link", { name: "ادامه کار" }).click();
  await expect(page).toHaveURL(/\/seller$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "کارهای نزدیک" })).toBeVisible();
  const sellerNavigation = page.getByRole("navigation", {
    name: "ناوبری فضای کار فروشنده",
  });
  await expect(sellerNavigation.first().getByRole("link")).toHaveCount(5);
  for (const label of ["خانه", "سفارش‌ها", "کالاها", "موجودی", "فروشگاه"]) {
    await expect(
      sellerNavigation.first().getByRole("link", { name: label }),
    ).toBeVisible();
  }
  await assertNoHorizontalOverflow(page);
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveCSS("outline-style", "solid");
  await assertMinimumContrast(page.getByRole("link", { name: "دیدن وضعیت فروشگاه" }));

  await sql`
    update identity_seller_access set status = 'SUSPENDED' where identity_id = ${identityId}
  `;
  await page.goto("/seller/orders");
  await expect(
    page.getByRole("heading", { name: "فضای کار اکنون در دسترس نیست" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "ناوبری فضای کار فروشنده" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "دیدن وضعیت درخواست" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await sql.end();
});
