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
  await page.getByLabel("نام کالا").fill("فنجان سرامیکی");
  await page
    .getByLabel("توضیح کالا")
    .fill("فنجان دست‌ساز مناسب نوشیدنی گرم و استفاده روزانه");
  const backToProducts = page.getByRole("button", { name: "بازگشت به کالاها" });
  await backToProducts.click();
  await expect(page).toHaveURL(/\/seller\/products$/);
  await page.getByRole("link", { name: "ساخت کالای تازه" }).click();
  await expect(page.getByRole("heading", { name: "مشخصات کالا" })).toBeVisible();
  await expect(page.getByLabel("نام کالا")).toHaveValue("فنجان سرامیکی");
  await expect(page.getByLabel("توضیح کالا")).toHaveValue(
    "فنجان دست‌ساز مناسب نوشیدنی گرم و استفاده روزانه",
  );
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
  const imageUploadKeys: string[] = [];
  let firstUploadKey = "";
  let exhaustedUploadKey = "";
  let exhaustedAttempts = 0;
  await page.route("**/api/store/seller/products/*/images", async (route) => {
    const key = route.request().headers()["idempotency-key"] ?? "";
    imageUploadKeys.push(key);
    if (!firstUploadKey) {
      firstUploadKey = key;
      await route.abort("timedout");
      return;
    }
    if (key !== firstUploadKey) {
      exhaustedUploadKey ||= key;
      if (key === exhaustedUploadKey && exhaustedAttempts < 3) {
        exhaustedAttempts += 1;
        await route.abort("timedout");
        return;
      }
    }
    await route.continue();
  });
  await page.getByLabel("انتخاب تصویر کالا").setInputFiles([
    { name: "cup.png", mimeType: "image/png", buffer: image },
    { name: "cup-side.png", mimeType: "image/png", buffer: image },
  ]);
  await expect(page.getByText("۲ تصویر انتخاب شده است")).toBeVisible();
  await page.getByRole("button", { name: "انتقال تصویر 2 به ابتدا" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(
    page.getByText("پاسخ سرور به‌موقع نرسید. دوباره تلاش کنید."),
  ).toBeVisible();
  expect(imageUploadKeys.filter((key) => key === firstUploadKey)).toHaveLength(2);
  expect(imageUploadKeys.filter((key) => key === exhaustedUploadKey)).toHaveLength(3);
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByRole("heading", { name: "فروش کالا" })).toBeVisible();
  const uploadAttemptsByKey = new Map<string, number>();
  for (const key of imageUploadKeys) {
    uploadAttemptsByKey.set(key, (uploadAttemptsByKey.get(key) ?? 0) + 1);
  }
  expect([...uploadAttemptsByKey.values()].sort()).toEqual([2, 4]);
  expect([...uploadAttemptsByKey.keys()].every(Boolean)).toBe(true);
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
  await page.getByRole("button", { name: "برگشت", exact: true }).click();
  await expect(page.getByRole("heading", { name: "تصویرهای کالا" })).toBeVisible();
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByLabel("قیمت گونه اصلی")).toHaveValue("440000");
  await expect(page.getByLabel("موجودی گونه اصلی")).toHaveValue("3");
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
  await page.getByRole("button", { name: "برگشت", exact: true }).click();
  await expect(page.getByText("موجودی باید عدد صحیح و نامنفی باشد.")).toBeVisible();
  await expect(page.getByLabel("موجودی قرمز، کوچک")).toHaveValue("-1");
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
  const publishedProductId = new URL(page.url()).pathname.split("/").at(-2) ?? "";
  await page.getByLabel("قیمت قرمز، کوچک").fill("456000");
  await page.getByRole("button", { name: "برگشت", exact: true }).click();
  await expect(page.getByRole("heading", { name: "تصویرهای کالا" })).toBeVisible();
  await expect(
    readPublicVariantAmount(page, e2eApiUrl, slug, publishedProductId, [
      "قرمز",
      "کوچک",
    ]),
  ).resolves.toBe(4_550_000);
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByLabel("قیمت قرمز، کوچک")).toHaveValue("456000");
  await page.getByRole("button", { name: "اعمال فروش و خروج" }).click();
  await expect(page).toHaveURL(/\/seller\/products$/);
  await expect(
    readPublicVariantAmount(page, e2eApiUrl, slug, publishedProductId, [
      "قرمز",
      "کوچک",
    ]),
  ).resolves.toBe(4_560_000);
  await page.getByRole("link", { name: "ویرایش فنجان سرامیکی" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  let offersSaved = 0;
  let inventorySaved = 0;
  let rejectedOffer = false;
  await page.route("**/api/store/seller/products/*/offers", async (route) => {
    if (!rejectedOffer) {
      rejectedOffer = true;
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          code: "VALIDATION_ERROR",
          message: "قیمت گونه را بررسی کنید.",
          correlationId: randomUUID(),
          details: {
            issues: [{ field: "rows.0.price.amount", code: "INVALID_FORMAT" }],
          },
        }),
      });
      return;
    }
    offersSaved += 1;
    await route.continue();
  });
  await page.route("**/api/store/seller/products/*/inventory", async (route) => {
    inventorySaved += 1;
    await route.continue();
  });
  await page.getByRole("button", { name: "اعمال فروش و دیدن پیش‌نمایش" }).click();
  await expect(page.getByLabel("قیمت قرمز، کوچک")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    page
      .getByLabel("قیمت قرمز، کوچک")
      .locator("..")
      .getByText("این مقدار را بررسی کنید."),
  ).toBeVisible();
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

  const productId = new URL(page.url()).pathname.split("/").at(-2) ?? "";
  await page.getByRole("button", { name: "ادامه ویرایش" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(
    page.getByText(
      "قیمت و موجودی تازه اکنون ذخیره می‌شود و فقط پس از انتشار دوباره برای خریدار دیده خواهد شد.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "اعمال فروش و دیدن پیش‌نمایش" }),
  ).toBeVisible();
  const unpublishedResponse = await page.request.get(
    `${e2eApiUrl}/v1/stores/${slug}/products/${productId}`,
  );
  expect(unpublishedResponse.status()).toBe(404);

  await page.goto(`/s/${slug}`);
  await expect(page.getByText("۰ کالای فعال")).toBeVisible();
  const storefrontHtml = await page.content();
  await expect(page.getByRole("link", { name: /فنجان سرامیکی/ })).toHaveCount(0);

  const newerDraft = await page.request.post("/api/store/seller/products", {
    headers: { "idempotency-key": `newer-draft-${randomUUID()}` },
    data: {},
  });
  expect(newerDraft.ok()).toBe(true);
  await page.goto("/seller/products");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText("کالای بدون نام", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "ویرایش فنجان سرامیکی" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "دیدن پیش‌نمایش" }).click();
  await page.getByRole("button", { name: "انتشار دوباره" }).click();
  await page.getByRole("link", { name: "دیدن کالا در فروشگاه" }).click();
  await expect(page.getByRole("heading", { name: "فنجان سرامیکی" })).toBeVisible();
  await expect(page.getByText("از ۴۵۶٬۰۰۰ تومان تا ۴۸۰٬۰۰۰ تومان")).toBeVisible();
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

async function readPublicVariantAmount(
  page: import("@playwright/test").Page,
  apiUrl: string,
  slug: string,
  productId: string,
  values: string[],
) {
  const response = await page.request.get(
    `${apiUrl}/v1/stores/${slug}/products/${productId}`,
  );
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    variants: Array<{
      combination: Array<{ value: string }>;
      price: { amount: number };
    }>;
  };
  const variant = body.variants.find(
    (candidate) =>
      candidate.combination.map((part) => part.value).join("|") === values.join("|"),
  );
  if (!variant) throw new Error(`Public variant ${values.join(", ")} was not found`);
  return variant.price.amount;
}
