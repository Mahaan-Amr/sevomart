import { randomUUID } from "node:crypto";

import postgres from "postgres";
import sharp from "sharp";
import { publicProductContract } from "@sevo/contracts/product/v1";

import { expect, test } from "../helpers/release-playwright";
import {
  simpleProductTracerTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("seller publishes one simple variant that a guest sees without private data", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const projectIndex = visualProjectIndex(testInfo.project.name);
  const mobile = simpleProductTracerTestMobiles[projectIndex]!;
  const slug = `simple-product-${projectIndex}`;
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const e2eApiUrl = `http://127.0.0.1:${process.env.SEVO_E2E_API_PORT ?? "3109"}`;

  await page.goto("/seller/login?returnTo=%2Fseller%2Fproducts%2Fnew");
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByRole("link", { name: "ادامه کار" })).toBeVisible();

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const identities = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId" from identity_login_methods
      where mobile = ${mobile}
    `;
    const identityId = identities[0]!.identityId;
    await sql`
      insert into identity_seller_access (id, identity_id, status)
      values (${randomUUID()}, ${identityId}::uuid, 'ACTIVE')
      on conflict (identity_id) do update set status = 'ACTIVE'
    `;
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
        (${storeId}, 'خانه دست‌سازه', ${slug}, 'کالاهای ساده و دست‌ساز',
         'تا هفت روز پس از تحویل می‌توانید درخواست مرجوعی را ثبت کنید.', 1,
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
  await page.getByLabel("نام کالا").fill("گلدان سفالی");
  await page.getByLabel("توضیح کالا").fill("گلدان سفالی دست‌ساز برای میز و فضای کوچک");
  await page.getByRole("button", { name: "ادامه" }).click();

  await expect(page.getByRole("heading", { name: "تصویرهای کالا" })).toBeVisible();
  const image = await sharp({
    create: { width: 900, height: 900, channels: 4, background: "#A41439" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("انتخاب تصویر کالا").setInputFiles({
    name: "vase.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(page.getByText("۱ تصویر انتخاب شده است")).toBeVisible();
  await page.getByRole("button", { name: "ادامه" }).click();

  await expect(page.getByRole("heading", { name: "فروش کالا" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "یک گونه" })).toBeChecked();
  await page.getByLabel("قیمت گونه اصلی").fill("325000");
  await page.getByLabel("موجودی گونه اصلی").fill("7");
  await page.getByRole("button", { name: "دیدن پیش‌نمایش" }).click();

  await expect(page.getByRole("heading", { name: "پیش‌نمایش کالا" })).toBeVisible();
  await expect(page.getByText("۳۲۵٬۰۰۰ تومان", { exact: true })).toBeVisible();
  await expect(page.getByText("موجود", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "انتشار کالا" }).click();

  const publicLink = page.getByRole("link", { name: "دیدن کالا در فروشگاه" });
  await expect(publicLink).toBeVisible();
  const publicHref = await publicLink.getAttribute("href");
  if (!publicHref) throw new Error("Published product link must have an href");
  const productId = new URL(publicHref, page.url()).pathname.split("/").at(-1)!;

  const guestContext = await browser.newContext({
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
    viewport: testInfo.project.use.viewport,
  });
  const guestPage = await guestContext.newPage();
  const publicProductResponse = await guestPage.request.get(
    `${e2eApiUrl}/v1/stores/${slug}/products/${productId}`,
  );
  expect(publicProductResponse.ok()).toBe(true);
  const publicProduct = publicProductContract.parse(await publicProductResponse.json());
  expect(publicProduct).toMatchObject({
    productId,
    name: "گلدان سفالی",
    axes: [],
    variants: [
      {
        combination: [],
        price: { amount: 3_250_000, currency: "IRR" },
        availability: "AVAILABLE",
      },
    ],
    priceRange: {
      minimum: { amount: 3_250_000, currency: "IRR" },
      maximum: { amount: 3_250_000, currency: "IRR" },
    },
    availability: "AVAILABLE",
    publicationVersion: 1,
  });
  expect(publicProduct.variants).toHaveLength(1);
  expect(numericValues(publicProduct)).not.toContain(7);

  await guestPage.goto(new URL(publicHref, page.url()).href);
  await expect(guestPage.getByRole("heading", { name: "گلدان سفالی" })).toBeVisible();
  await expect(guestPage.getByText("۳۲۵٬۰۰۰ تومان", { exact: true })).toBeVisible();
  await expect(guestPage.getByText("موجود", { exact: true }).first()).toBeVisible();
  await expect(guestPage.getByRole("button", { name: "افزودن به سبد" })).toBeEnabled();
  expect(await guestPage.locator("body").innerText()).not.toMatch(
    /(?:^|[^\d۰-۹])[7۷](?:[^\d۰-۹]|$)/,
  );

  const publicSurface = `${await guestPage.content()}\n${JSON.stringify(publicProduct)}`;
  for (const privateField of [
    "sellerId",
    "identityId",
    "mobile",
    "bank",
    "sku",
    "onHand",
    "workingCopy",
    "inventory",
  ]) {
    expect(publicSurface).not.toContain(`"${privateField}"`);
  }
  await guestContext.close();
});

function numericValues(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(numericValues);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(numericValues);
  }
  return [];
}
