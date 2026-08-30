import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  productTracerTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("seller publishes a two-axis product that a guest sees on the storefront", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const projectIndex = visualProjectIndex(testInfo.project.name);
  const mobile = productTracerTestMobiles[projectIndex]!;
  const slug = `product-tracer-${projectIndex}`;
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
  const backToProducts = page.getByRole("link", { name: "بازگشت به کالاها" });
  await expect(backToProducts).toHaveAttribute("href", "/seller/products");
  await backToProducts.click();
  await expect(page).toHaveURL(/\/seller\/products$/);
  await page.getByRole("link", { name: "ساخت کالای تازه" }).click();
  await expect(page.getByRole("heading", { name: "مشخصات کالا" })).toBeVisible();
  await page.getByLabel("نام کالا").fill("فنجان سرامیکی");
  await page
    .getByLabel("توضیح کالا")
    .fill("فنجان دست‌ساز مناسب نوشیدنی گرم و استفاده روزانه");
  await page.getByRole("button", { name: "ذخیره و خروج" }).click();
  await expect(page).toHaveURL(/\/seller\/products$/);
  await page.getByRole("link", { name: "ساخت کالای تازه" }).click();
  await expect(page.getByLabel("نام کالا")).toHaveValue("فنجان سرامیکی");
  await expect(page.getByLabel("توضیح کالا")).toHaveValue(
    "فنجان دست‌ساز مناسب نوشیدنی گرم و استفاده روزانه",
  );
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByRole("heading", { name: "تصویرهای کالا" })).toBeVisible();
  const image = await sharp({
    create: { width: 900, height: 900, channels: 4, background: "#A41439" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("انتخاب تصویر کالا").setInputFiles([
    { name: "cup.png", mimeType: "image/png", buffer: image },
    { name: "cup-side.png", mimeType: "image/png", buffer: image },
  ]);
  await expect(page.getByText("۲ تصویر انتخاب شده است")).toBeVisible();
  await page.getByRole("button", { name: "انتقال تصویر 2 به ابتدا" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "ادامه" }).click();

  await expect(page.getByRole("heading", { name: "فروش کالا" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "مشخصات کالا" })).toBeVisible();
  await expect(page.getByLabel("نام کالا")).toHaveValue("فنجان سرامیکی");
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByRole("heading", { name: "تصویرهای کالا" })).toBeVisible();
  await expect(page.getByText("۲ تصویر انتخاب شده است")).toBeVisible();
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByRole("heading", { name: "فروش کالا" })).toBeVisible();
  await page.getByLabel("قیمت گونه اصلی").fill("440000");
  await page.getByLabel("موجودی گونه اصلی").fill("3");
  await page.getByRole("button", { name: "دیدن پیش‌نمایش" }).click();
  await expect(page.getByRole("heading", { name: "پیش‌نمایش کالا" })).toBeVisible();
  await expect(page.getByText("۴۴۰٬۰۰۰ تومان", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "برگشت و ویرایش" }).click();
  await page.getByRole("radio", { name: "چندگونه" }).click();
  await page.getByLabel("نام محور 1").fill("رنگ");
  await page.getByRole("textbox", { name: "مقدار 1 محور 1", exact: true }).fill("قرمز");
  await page.getByRole("button", { name: "افزودن مقدار" }).click();
  await page.getByRole("textbox", { name: "مقدار 2 محور 1", exact: true }).fill("قرمز");
  await expect(
    page.getByText("این مقدار در همین محور تکراری است.").first(),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "مقدار 2 محور 1", exact: true }).fill("آبی");
  await page.getByRole("button", { name: "افزودن محور دوم" }).click();
  await page.getByLabel("نام محور 2").fill("اندازه");
  await page.getByRole("textbox", { name: "مقدار 1 محور 2", exact: true }).fill("کوچک");
  await page.getByRole("button", { name: "افزودن مقدار" }).nth(1).click();
  await page.getByRole("textbox", { name: "مقدار 2 محور 2", exact: true }).fill("بزرگ");
  await expect(page.getByText("۴ گونه ساخته می‌شود")).toBeVisible();

  await page.getByLabel("قیمت قرمز، کوچک").fill("450000");
  await page.getByLabel("موجودی قرمز، کوچک").fill("-1");
  await page.getByRole("button", { name: "دیدن پیش‌نمایش" }).click();
  await expect(page.getByText("موجودی باید عدد صحیح و نامنفی باشد.")).toBeVisible();
  await page.getByLabel("موجودی قرمز، کوچک").fill("8");
  await page.getByLabel("قیمت قرمز، بزرگ").fill("460000");
  await page.getByLabel("موجودی قرمز، بزرگ").fill("0");
  await page.getByLabel("قیمت آبی، کوچک").fill("470000");
  await page.getByLabel("موجودی آبی، کوچک").fill("2");
  await page.getByLabel("قیمت آبی، بزرگ").fill("480000");
  await page.getByLabel("موجودی آبی، بزرگ").fill("1");
  await page.getByRole("button", { name: "دیدن پیش‌نمایش" }).click();

  await expect(page.getByRole("heading", { name: "پیش‌نمایش کالا" })).toBeVisible();
  await expect(page.getByText("از ۴۵۰٬۰۰۰ تومان تا ۴۸۰٬۰۰۰ تومان")).toBeVisible();
  await expect(page.getByText("۴۵۰٬۰۰۰ تومان · موجود", { exact: true })).toBeVisible();
  await expect(
    page.getByText("۴۶۰٬۰۰۰ تومان · ناموجود", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "برگشت و ویرایش" }).click();
  await page.getByLabel("قیمت قرمز، کوچک").fill("455000");
  await page.getByRole("button", { name: "دیدن پیش‌نمایش" }).click();
  await expect(page.getByText("از ۴۵۵٬۰۰۰ تومان تا ۴۸۰٬۰۰۰ تومان")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page);
  await assertMinimumContrast(page.locator("main h1, main p, main button"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedTransition = await page
    .getByRole("button", { name: "انتشار کالا" })
    .evaluate((button) => getComputedStyle(button).transitionDuration);
  expect(Number.parseFloat(reducedTransition) || 0).toBeLessThanOrEqual(0.001);
  const publicationKeys: string[] = [];
  let interruptedPublication = false;
  await page.route("**/api/store/seller/products/*/publications", async (route) => {
    publicationKeys.push(route.request().headers()["idempotency-key"] ?? "");
    if (!interruptedPublication) {
      interruptedPublication = true;
      await route.fetch();
      await route.abort("timedout");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "انتشار کالا" }).focus();
  await page.keyboard.press("Enter");

  const publicLink = page.getByRole("link", { name: "دیدن کالا در فروشگاه" });
  await expect(publicLink).toBeVisible();
  expect(publicationKeys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(publicationKeys).size).toBe(1);

  await page.getByRole("link", { name: "ویرایش کالا" }).click();
  await expect(page.getByRole("heading", { name: "مشخصات کالا" })).toBeVisible();
  await expect(page.getByLabel("نام کالا")).toHaveValue("فنجان سرامیکی");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  let offersSaved = 0;
  let inventorySaved = 0;
  await page.route("**/api/store/seller/products/*/offers", async (route) => {
    offersSaved += 1;
    await route.continue();
  });
  await page.route("**/api/store/seller/products/*/inventory", async (route) => {
    inventorySaved += 1;
    await route.continue();
  });
  await page.getByRole("button", { name: "اعمال فروش و دیدن پیش‌نمایش" }).click();
  await expect(page.getByRole("button", { name: "توقف انتشار" })).toBeVisible();
  await expect.poll(() => offersSaved).toBe(1);
  await expect.poll(() => inventorySaved).toBe(1);
  const unpublicationKeys: string[] = [];
  let interruptedUnpublication = false;
  await page.route("**/api/store/seller/products/*/unpublication", async (route) => {
    unpublicationKeys.push(route.request().headers()["idempotency-key"] ?? "");
    if (!interruptedUnpublication) {
      interruptedUnpublication = true;
      await route.fetch();
      await route.abort("timedout");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "توقف انتشار" }).click();
  await expect(
    page.getByRole("heading", { name: "انتشار کالا متوقف شد" }),
  ).toBeVisible();
  expect(unpublicationKeys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(unpublicationKeys).size).toBe(1);

  const productId = await readProductId(page);
  const unpublishedResponse = await page.request.get(
    `${e2eApiUrl}/v1/stores/${slug}/products/${productId}`,
  );
  expect(unpublishedResponse.status()).toBe(404);

  await page.goto(`/s/${slug}`);
  await expect(page.getByText("۰ کالای فعال")).toBeVisible();
  const storefrontHtml = await page.content();
  await expect(page.getByRole("link", { name: /فنجان سرامیکی/ })).toHaveCount(0);

  await page.goto("/seller/products");
  await page.getByRole("link", { name: "ویرایش آخرین کالا" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "دیدن پیش‌نمایش" }).click();
  await page.getByRole("button", { name: "انتشار دوباره" }).click();
  await page.getByRole("link", { name: "دیدن کالا در فروشگاه" }).click();
  await expect(page.getByRole("heading", { name: "فنجان سرامیکی" })).toBeVisible();
  await expect(page.getByText("از ۴۵۵٬۰۰۰ تومان تا ۴۸۰٬۰۰۰ تومان")).toBeVisible();
  await expect(page.getByText("قرمز، بزرگ", { exact: true })).toBeVisible();
  await expect(page.getByText(/۴۶۰٬۰۰۰ تومان · ناموجود/)).toBeVisible();
  await expect(page.getByText("موجود", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("8", { exact: true })).toHaveCount(0);
  const publicStoreResponse = await page.request.get(`${e2eApiUrl}/v1/stores/${slug}`);
  const publicProductsResponse = await page.request.get(
    `${e2eApiUrl}/v1/stores/${slug}/products`,
  );
  expect(publicStoreResponse.ok()).toBe(true);
  expect(publicProductsResponse.ok()).toBe(true);
  const publicSurface = `${storefrontHtml}\n${await page.content()}\n${JSON.stringify([
    await publicStoreResponse.json(),
    await publicProductsResponse.json(),
  ])}`;
  for (const privateField of [
    "sellerId",
    "identityId",
    "mobile",
    "bank",
    "sku",
    "onHand",
    "workingCopy",
    "inventory",
    "viewCount",
    "likeCount",
    "conversionRate",
  ]) {
    expect(publicSurface).not.toContain(`"${privateField}"`);
  }
  await expect(page.locator("img")).toHaveJSProperty("complete", true);
  await assertNoHorizontalOverflow(page);
});

async function readProductId(page: import("@playwright/test").Page) {
  return page.evaluate(() => localStorage.getItem("sevo-last-product-id") ?? "");
}
