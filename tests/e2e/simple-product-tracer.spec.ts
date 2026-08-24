import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

import {
  assertInteractiveTargets,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  productTracerTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("seller publishes a simple product that a guest sees on the storefront", async ({
  page,
}, testInfo) => {
  const projectIndex = visualProjectIndex(testInfo.project.name);
  const mobile = productTracerTestMobiles[projectIndex]!;
  const slug = `product-tracer-${projectIndex}`;
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";

  await page.goto("/seller/login?returnTo=%2Fseller%2Fproducts%2Fnew");
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const identities = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId" from identity_login_methods
      where mobile = ${mobile}
    `;
    const identityId = identities[0]!.identityId;
    await sql`
      delete from store_stores where id in (
        select store_id from store_memberships where seller_id = ${identityId}::uuid
      )
    `;
    const storeId = randomUUID();
    await sql`
      insert into store_stores
        (id, name, slug, bio, return_policy, return_policy_revision,
         settlement_kind, settlement_status, settlement_verified_at,
         theme_color, status, published_at, publication_version, revision)
      values
        (${storeId}, 'خانه فنجان', ${slug}, 'کالاهای ساده و دست‌ساز',
         'تا هفت روز امکان درخواست مرجوعی وجود دارد.', 1,
         'TEST', 'TEST_VERIFIED', now(), '#A41439', 'PUBLISHED', now(), 1, 1)
    `;
    await sql`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${randomUUID()}, ${storeId}, ${identityId}, 'OWNER')
    `;
    await sql`
      insert into store_shipping_methods
        (id, store_id, position, revision, code, label, fixed_fee_amount,
         currency, estimated_delivery_text, enabled,
         requires_delivery_address, requires_postal_code)
      values
        (${randomUUID()}, ${storeId}, 0, 1, 'NATIONAL_POST', 'پست پیشتاز', 0,
         'IRR', 'زمان دقیق ارسال هنگام ثبت سفارش مشخص می‌شود.', true, true, true)
    `;
  } finally {
    await sql.end();
  }

  await page.getByRole("link", { name: "ادامه کار" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "مشخصات کالا" })).toBeVisible();
  await page.getByLabel("نام کالا").fill("فنجان سرامیکی");
  await page
    .getByLabel("توضیح کالا")
    .fill("فنجان دست‌ساز مناسب نوشیدنی گرم و استفاده روزانه");
  await page.getByRole("button", { name: "ادامه" }).click();

  const image = await sharp({
    create: { width: 900, height: 900, channels: 4, background: "#A41439" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("تصویر کالا").setInputFiles({
    name: "cup.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.getByRole("button", { name: "ادامه" }).click();

  await page.getByLabel("قیمت به تومان").fill("450000");
  await page.getByLabel("موجودی").fill("8");
  await page.getByRole("button", { name: "دیدن پیش‌نمایش" }).click();

  await expect(page.getByRole("heading", { name: "بازبینی کالا" })).toBeVisible();
  await expect(page.getByText("۴۵۰٬۰۰۰ تومان")).toBeVisible();
  await expect(page.getByText("موجود")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page);
  await page.getByRole("button", { name: "انتشار کالا" }).focus();
  await page.keyboard.press("Enter");

  const publicLink = page.getByRole("link", { name: "دیدن کالا در فروشگاه" });
  await expect(publicLink).toBeVisible();
  await page.goto(`/s/${slug}`);
  const storefrontProduct = page.getByRole("link", { name: /فنجان سرامیکی/ });
  await expect(storefrontProduct).toBeVisible();
  await storefrontProduct.click();
  await expect(page.getByRole("heading", { name: "فنجان سرامیکی" })).toBeVisible();
  await expect(page.getByText("۴۵۰٬۰۰۰ تومان")).toBeVisible();
  await expect(page.getByText("موجود")).toBeVisible();
  await expect(page.getByText("8", { exact: true })).toHaveCount(0);
  await expect(page.locator("img")).toHaveJSProperty("complete", true);
  await assertNoHorizontalOverflow(page);
});
