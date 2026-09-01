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
  test.setTimeout(120_000);
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
         'تا هفت روز پس از تحویل می‌توانید برای کالای استفاده‌نشده درخواست مرجوعی ثبت کنید؛ کالا باید با بسته‌بندی و متعلقات کامل بازگردانده شود.', 1,
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
  const uploadedMediaIds = new Map<string, string>();
  let authoredProductId = "";
  let firstUploadKey = "";
  let exhaustedUploadKey = "";
  let exhaustedAttempts = 0;
  let releaseFirstUpload: (() => void) | undefined;
  const firstUploadGate = new Promise<void>((resolve) => {
    releaseFirstUpload = resolve;
  });
  page.on("response", async (response) => {
    if (
      response.request().method() !== "POST" ||
      !response.url().match(/\/api\/store\/seller\/products\/[0-9a-f-]+\/images$/) ||
      !response.ok()
    ) {
      return;
    }
    const requestBody = response.request().postData() ?? "";
    const fileName = ["cup.png", "cup-side.png", "cup-handle.png", "cup-box.png"].find(
      (candidate) => requestBody.includes(candidate),
    );
    const body = (await response.json()) as { id: string };
    if (fileName) uploadedMediaIds.set(fileName, body.id);
    authoredProductId ||= new URL(response.url()).pathname.split("/").at(-2) ?? "";
  });
  await page.route("**/api/store/seller/products/*/images", async (route) => {
    const key = route.request().headers()["idempotency-key"] ?? "";
    imageUploadKeys.push(key);
    if (!firstUploadKey) {
      firstUploadKey = key;
      await firstUploadGate;
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
    { name: "cup-handle.png", mimeType: "image/png", buffer: image },
    { name: "cup-box.png", mimeType: "image/png", buffer: image },
  ]);
  await expect(page.getByText("۴ تصویر انتخاب شده است")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /انتقال تصویر \d به قبل/ }),
  ).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: /انتقال تصویر \d به بعد/ }),
  ).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "انتقال تصویر 1 به قبل" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "انتقال تصویر 4 به بعد" }),
  ).toBeDisabled();
  await assertMinimumContrast(page.locator("main button"));
  await page.getByLabel("انتخاب تصویر کالا").focus();
  await tabTo(page, page.getByRole("button", { name: "انتقال تصویر 4 به قبل" }));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("button", { name: "انتقال تصویر 1 به بعد" }));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("button", { name: "ادامه" }));
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("انتخاب تصویر کالا")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "انتقال تصویر 2 به قبل" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "حذف تصویر 2" })).toBeDisabled();
  releaseFirstUpload?.();
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
  expect([...uploadAttemptsByKey.values()].sort()).toEqual([1, 1, 2, 4]);
  expect([...uploadAttemptsByKey.keys()].every(Boolean)).toBe(true);
  await expect.poll(() => uploadedMediaIds.size).toBe(4);
  const expectedMediaIds = [
    "cup-box.png",
    "cup-side.png",
    "cup-handle.png",
    "cup.png",
  ].map((fileName) => uploadedMediaIds.get(fileName));
  expect(expectedMediaIds.every(Boolean)).toBe(true);
  await expectSellerWorkingMediaOrder(page, authoredProductId, expectedMediaIds);
  await page.reload();
  await expect(page.getByRole("heading", { name: "مشخصات کالا" })).toBeVisible();
  await expect(page.getByLabel("نام کالا")).toHaveValue("فنجان سرامیکی");
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByRole("heading", { name: "تصویرهای کالا" })).toBeVisible();
  await expect(page.getByText("۴ تصویر انتخاب شده است")).toBeVisible();
  await expectSellerWorkingMediaOrder(page, authoredProductId, expectedMediaIds);
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByRole("heading", { name: "فروش کالا" })).toBeVisible();
  await page.getByLabel("قیمت گونه اصلی").fill("440000");
  await page.getByLabel("موجودی گونه اصلی").fill("3");
  await page.getByRole("button", { name: "برگشت", exact: true }).click();
  await expect(page.getByRole("heading", { name: "تصویرهای کالا" })).toBeVisible();
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByLabel("قیمت گونه اصلی")).toHaveValue("440000");
  await expect(page.getByLabel("موجودی گونه اصلی")).toHaveValue("3");
  const previewResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/products/${authoredProductId}/preview`),
  );
  await page.getByRole("button", { name: "دیدن پیش‌نمایش" }).click();
  const previewResponse = await previewResponsePromise;
  expect(previewResponse.ok()).toBe(true);
  expect(
    (
      (await previewResponse.json()) as {
        projection: { images: Array<{ id: string }> };
      }
    ).projection.images.map((entry) => entry.id),
  ).toEqual(expectedMediaIds);
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
  const publishedProductResponse = await page.request.get(
    `${e2eApiUrl}/v1/stores/${slug}/products/${authoredProductId}`,
  );
  expect(publishedProductResponse.ok()).toBe(true);
  expect(
    (
      (await publishedProductResponse.json()) as {
        images: Array<{ id: string }>;
      }
    ).images.map((entry) => entry.id),
  ).toEqual(expectedMediaIds);
  const publicProductPath = await publicLink.getAttribute("href");
  expect(publicProductPath).toBeTruthy();
  const publicProductPage = await page.context().newPage();
  await publicProductPage.goto(publicProductPath!);
  await expect(
    publicProductPage.getByRole("img", { name: "فنجان سرامیکی", exact: true }),
  ).toHaveAttribute("src", new RegExp(expectedMediaIds[0]!));
  await publicProductPage.close();

  await page.getByRole("link", { name: "ویرایش کالا" }).click();
  await expect(page.getByRole("heading", { name: "مشخصات کالا" })).toBeVisible();
  const publishedProductId = new URL(page.url()).pathname.split("/").at(-2) ?? "";
  await expect(page.getByLabel("نام کالا")).toHaveValue("فنجان سرامیکی");
  await page
    .getByLabel("توضیح کالا")
    .fill("فنجان دست‌ساز با توضیح بازبینی‌شده فروشنده");
  let rejectedWorkingCopyRevision = false;
  let concurrentWorkingRevision = 0;
  await page.route("**/api/store/seller/products/*/working-copy", async (route) => {
    if (rejectedWorkingCopyRevision) return route.continue();
    rejectedWorkingCopyRevision = true;
    const latestResponse = await page.request.get(
      `/api/store/seller/products/${publishedProductId}`,
    );
    expect(latestResponse.ok()).toBe(true);
    const latest = (await latestResponse.json()) as {
      revision: number;
      workingCopy: {
        name: string;
        description: string;
        orderedMediaIds: string[];
        axes: unknown[];
        variants: Array<{
          clientKey: string;
          combination: unknown[];
          price: { amount: number; currency: "IRR" } | null;
          sku: string | null;
        }>;
      } | null;
    };
    expect(latest.workingCopy).not.toBeNull();
    const concurrentResponse = await page.request.put(
      `/api/store/seller/products/${publishedProductId}/working-copy`,
      {
        headers: {
          "idempotency-key": `concurrent-working-${randomUUID()}`,
          "if-match": `"${latest.revision}"`,
        },
        data: {
          expectedRevision: latest.revision,
          workingCopy: {
            name: "فنجان تازه سرور",
            description: latest.workingCopy!.description,
            orderedMediaIds: latest.workingCopy!.orderedMediaIds,
            axes: latest.workingCopy!.axes,
            variants: latest.workingCopy!.variants.map((variant) => ({
              clientKey: variant.clientKey,
              combination: variant.combination,
              price: variant.price,
              sku: variant.sku,
            })),
          },
          inventory: null,
        },
      },
    );
    const concurrentBody = (await concurrentResponse.json()) as {
      revision?: number;
    };
    expect(
      concurrentResponse.ok(),
      `${concurrentResponse.status()} ${JSON.stringify(concurrentBody)}`,
    ).toBe(true);
    concurrentWorkingRevision = concurrentBody.revision ?? 0;
    expect(concurrentWorkingRevision).toBeGreaterThan(latest.revision);
    await route.continue();
  });
  const staleWorkingResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/products/${publishedProductId}/working-copy`) &&
      response.status() === 409,
  );
  await page.getByRole("button", { name: "ادامه" }).click();
  await staleWorkingResponse;
  await expect(
    page.getByRole("heading", { name: "تغییرهای هم‌زمان را بازبینی کنید" }),
  ).toBeVisible();
  expect(concurrentWorkingRevision).toBeGreaterThan(0);
  await page.getByRole("button", { name: "بازگشت به ویرایش" }).click();
  await expect(page.getByRole("heading", { name: "مشخصات کالا" })).toBeVisible();
  await expect(page.getByLabel("نام کالا")).toHaveValue("فنجان سرامیکی");
  await expect(page.getByLabel("توضیح کالا")).toHaveValue(
    "فنجان دست‌ساز با توضیح بازبینی‌شده فروشنده",
  );
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(
    page.getByRole("heading", { name: "تغییرهای هم‌زمان را بازبینی کنید" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page);
  await assertMinimumContrast(
    page.locator("main h1, main h2, main p, main strong, main small, main button"),
  );
  const prepareConflict = page.getByRole("button", {
    name: "آماده‌کردن تغییرهای انتخاب‌شده",
  });
  await expect(prepareConflict).toBeDisabled();
  expect(
    Number.parseFloat(
      await prepareConflict.evaluate(
        (button) => getComputedStyle(button).transitionDuration,
      ),
    ) || 0,
  ).toBeLessThanOrEqual(0.001);
  const nameConflict = page.getByRole("group", { name: "نام کالا" });
  await expect(nameConflict).toContainText("فنجان تازه سرور");
  const freshName = nameConflict.getByRole("radio", { name: /نسخه تازه/ });
  await freshName.focus();
  await page.keyboard.press("Space");
  await expect(freshName).toBeChecked();
  const descriptionConflict = page.getByRole("group", { name: "توضیح کالا" });
  await expect(descriptionConflict).toContainText("توضیح بازبینی‌شده فروشنده");
  await expect(descriptionConflict).toContainText("مناسب نوشیدنی گرم");
  const localDescription = descriptionConflict.getByRole("radio", {
    name: /تغییر من/,
  });
  await localDescription.focus();
  await page.keyboard.press("Space");
  await expect(localDescription).toBeChecked();
  await prepareConflict.click();
  await expect(page.getByRole("heading", { name: "مشخصات کالا" })).toBeVisible();
  await expect(page.getByLabel("نام کالا")).toHaveValue("فنجان تازه سرور");
  await expect(page.getByLabel("توضیح کالا")).toHaveValue(
    "فنجان دست‌ساز با توضیح بازبینی‌شده فروشنده",
  );
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByRole("heading", { name: "تصویرهای کالا" })).toBeVisible();
  const reconciledWorkingCopy = await page.request.get(
    `/api/store/seller/products/${publishedProductId}`,
  );
  expect(reconciledWorkingCopy.ok()).toBe(true);
  expect(
    (await reconciledWorkingCopy.json()) as {
      revision: number;
      workingCopy: { name: string; description: string };
    },
  ).toMatchObject({
    revision: expect.any(Number),
    workingCopy: {
      name: "فنجان تازه سرور",
      description: "فنجان دست‌ساز با توضیح بازبینی‌شده فروشنده",
    },
  });
  await page.getByRole("button", { name: "ادامه" }).click();
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
  await page.getByRole("link", { name: "ویرایش فنجان تازه سرور" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByLabel("قیمت قرمز، کوچک").fill("457000");
  await page.getByLabel("موجودی قرمز، کوچک").fill("9");
  let offersSaved = 0;
  let inventorySaved = 0;
  let rejectedOfferRevision = false;
  let concurrentOfferRevision = 0;
  let rejectedOffer = false;
  await page.route("**/api/store/seller/products/*/offers", async (route) => {
    if (!rejectedOfferRevision) {
      rejectedOfferRevision = true;
      const latestResponse = await page.request.get(
        `/api/store/seller/products/${publishedProductId}`,
      );
      expect(latestResponse.ok()).toBe(true);
      const latest = (await latestResponse.json()) as {
        revision: number;
        workingCopy: {
          variants: Array<{
            variantId: string;
            price: { amount: number; currency: "IRR" } | null;
            sku: string | null;
            offerRevision: number;
          }>;
        };
      };
      const concurrentResponse = await page.request.put(
        `/api/store/seller/products/${publishedProductId}/offers`,
        {
          headers: {
            "idempotency-key": `concurrent-offer-${randomUUID()}`,
            "if-match": `"${latest.revision}"`,
          },
          data: {
            expectedRevision: latest.revision,
            rows: latest.workingCopy.variants.map((variant, index) => ({
              variantId: variant.variantId,
              price:
                index === 0 ? { amount: 4_580_000, currency: "IRR" } : variant.price,
              sku: variant.sku,
              expectedRevision: variant.offerRevision,
            })),
          },
        },
      );
      expect(concurrentResponse.ok()).toBe(true);
      concurrentOfferRevision = (
        (await concurrentResponse.json()) as { productRevision: number }
      ).productRevision;
      expect(concurrentOfferRevision).toBeGreaterThan(latest.revision);
      await route.continue();
      return;
    }
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
  let rejectedInventoryRevision = false;
  let concurrentInventoryRevision = 0;
  await page.route("**/api/store/seller/products/*/inventory", async (route) => {
    if (!rejectedInventoryRevision) {
      rejectedInventoryRevision = true;
      const latestResponse = await page.request.get(
        `/api/store/seller/products/${publishedProductId}`,
      );
      expect(latestResponse.ok()).toBe(true);
      const latest = (await latestResponse.json()) as {
        revision: number;
        inventory: Array<{
          variantId: string;
          onHand: number;
          revision: number;
        }>;
      };
      const concurrentResponse = await page.request.put(
        `/api/store/seller/products/${publishedProductId}/inventory`,
        {
          headers: {
            "idempotency-key": `concurrent-inventory-${randomUUID()}`,
            "if-match": `"${latest.revision}"`,
          },
          data: {
            expectedRevision: latest.revision,
            reasonCode: "MANUAL_COUNT",
            rows: latest.inventory.map((row, index) => ({
              variantId: row.variantId,
              onHand: index === 0 ? 10 : row.onHand,
              expectedRevision: row.revision,
            })),
          },
        },
      );
      expect(concurrentResponse.ok()).toBe(true);
      concurrentInventoryRevision = (
        (await concurrentResponse.json()) as { productRevision: number }
      ).productRevision;
      expect(concurrentInventoryRevision).toBeGreaterThan(latest.revision);
      await route.continue();
      return;
    }
    inventorySaved += 1;
    await route.continue();
  });
  await page.getByRole("button", { name: "اعمال فروش و دیدن پیش‌نمایش" }).click();
  await expect(
    page.getByRole("heading", { name: "تغییرهای هم‌زمان را بازبینی کنید" }),
  ).toBeVisible();
  expect(concurrentOfferRevision).toBeGreaterThan(0);
  const offerConflict = page.getByRole("group", {
    name: "قیمت گونه قرمز، کوچک",
  });
  await expect(offerConflict).toContainText("۴۵۷٬۰۰۰ تومان");
  await expect(offerConflict).toContainText("۴۵۸٬۰۰۰ تومان");
  await offerConflict.getByRole("radio", { name: /تغییر من/ }).click();
  const firstInventoryConflict = page.getByRole("group", {
    name: "موجودی گونه قرمز، کوچک",
  });
  await firstInventoryConflict.getByRole("radio", { name: /تغییر من/ }).click();
  await page.getByRole("button", { name: "آماده‌کردن تغییرهای انتخاب‌شده" }).click();
  await expect(page.getByLabel("قیمت قرمز، کوچک")).toHaveValue("457000");
  await expect(page.getByLabel("موجودی قرمز، کوچک")).toHaveValue("9");
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
  await expect(
    page.getByRole("heading", { name: "تغییرهای هم‌زمان را بازبینی کنید" }),
  ).toBeVisible();
  expect(concurrentInventoryRevision).toBeGreaterThan(0);
  const inventoryConflict = page.getByRole("group", {
    name: "موجودی گونه قرمز، کوچک",
  });
  await expect(inventoryConflict).toContainText("۹ عدد");
  await expect(inventoryConflict).toContainText("۱۰ عدد");
  await inventoryConflict.getByRole("radio", { name: /تغییر من/ }).click();
  await page.getByRole("button", { name: "آماده‌کردن تغییرهای انتخاب‌شده" }).click();
  await page.getByRole("button", { name: "اعمال فروش و دیدن پیش‌نمایش" }).click();
  await expect(page.getByRole("button", { name: "توقف انتشار" })).toBeVisible();
  await expect.poll(() => offersSaved).toBe(2);
  await expect.poll(() => inventorySaved).toBe(1);
  await expect(
    readPublicVariantAmount(page, e2eApiUrl, slug, publishedProductId, [
      "قرمز",
      "کوچک",
    ]),
  ).resolves.toBe(4_570_000);
  const reconciledSaleResponse = await page.request.get(
    `/api/store/seller/products/${publishedProductId}`,
  );
  expect(reconciledSaleResponse.ok()).toBe(true);
  expect(
    (
      (await reconciledSaleResponse.json()) as {
        inventory: Array<{ onHand: number }>;
      }
    ).inventory[0]?.onHand,
  ).toBe(9);
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

  await page.goto("/seller/inventory");
  await expect(
    page.getByRole("heading", { name: "اصلاح موجودی گونه‌ها" }),
  ).toBeVisible();
  await page.getByLabel("جست‌وجوی نام کالا یا ویژگی گونه").fill("قرمز بزرگ");
  const zeroStockVariant = page
    .getByRole("listitem")
    .filter({ hasText: "رنگ: قرمز، اندازه: بزرگ" });
  await expect(zeroStockVariant.getByText("ناموجود", { exact: true })).toBeVisible();
  await expect(
    zeroStockVariant
      .locator("dl div")
      .filter({ has: page.getByText("موجودی", { exact: true }) })
      .getByText("۰", { exact: true }),
  ).toBeVisible();
  await zeroStockVariant.getByRole("button", { name: /افزایش موجودی/ }).click();
  await expect(page.getByLabel("مقدار افزایش")).toBeVisible();

  await page.goto(`/s/${slug}`);
  await expect(page.getByText("۰ کالای فعال")).toBeVisible();
  const storefrontHtml = await page.content();
  await expect(page.getByRole("link", { name: /فنجان تازه سرور/ })).toHaveCount(0);

  const newerDraft = await page.request.post("/api/store/seller/products", {
    headers: { "idempotency-key": `newer-draft-${randomUUID()}` },
    data: {},
  });
  expect(newerDraft.ok()).toBe(true);
  await page.goto("/seller/products");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText("کالای بدون نام", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "ویرایش فنجان تازه سرور" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "دیدن پیش‌نمایش" }).click();
  await page.getByRole("button", { name: "انتشار دوباره" }).click();
  await page.getByRole("link", { name: "دیدن کالا در فروشگاه" }).click();
  await expect(page.getByRole("heading", { name: "فنجان تازه سرور" })).toBeVisible();
  await expect(page.getByText("از ۴۵۶٬۰۰۰ تومان تا ۴۸۰٬۰۰۰ تومان")).toHaveCount(0);
  await expect(page.getByText("رنگ", { exact: true })).toBeVisible();
  await expect(page.getByText("قرمز، آبی", { exact: true })).toBeVisible();
  await expect(page.getByText("اندازه", { exact: true })).toBeVisible();
  await expect(page.getByText("کوچک، بزرگ", { exact: true })).toBeVisible();
  await expect(page.getByText("قرمز، بزرگ", { exact: true })).toBeVisible();
  await expect(page.getByText(/۴۶۰٬۰۰۰ تومان · ناموجود/)).toBeVisible();
  await expect(page.getByText("خانه فنجان", { exact: true })).toBeVisible();
  await expect(page.getByText("پست پیشتاز", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "روش‌های ارسال" })).toContainText(
    "۰ تومان",
  );
  await expect(
    page.getByText("زمان دقیق ارسال هنگام ثبت سفارش مشخص می‌شود."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "تا هفت روز پس از تحویل می‌توانید برای کالای استفاده‌نشده درخواست مرجوعی ثبت کنید؛ کالا باید با بسته‌بندی و متعلقات کامل بازگردانده شود.",
    ),
  ).toBeVisible();
  const variantSelector = page.getByLabel("گونه", { exact: true });
  const addButton = page.getByRole("button", { name: "گونه را انتخاب کنید" });
  const selectedOffer = page.getByRole("status");
  await expect(selectedOffer).toContainText(
    "برای دیدن قیمت و موجودی، گونه را انتخاب کنید.",
  );
  await expect(selectedOffer).toHaveAttribute("aria-live", "polite");
  const addButtonHandle = await addButton.elementHandle();
  if (!addButtonHandle) throw new Error("The add-to-cart action must be rendered");
  for (const termsId of ["store-title", "shipping-title", "returns-title"]) {
    expect(
      await page.locator(`#${termsId}`).evaluate((terms, button) => {
        return Boolean(
          terms.compareDocumentPosition(button as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }, addButtonHandle),
    ).toBe(true);
  }
  await expect(variantSelector).toHaveValue("");
  await expect(addButton).toBeDisabled();
  await expect(page.getByLabel("تعداد")).toBeDisabled();
  await variantSelector.focus();
  await expect(variantSelector).toBeFocused();
  await variantSelector.selectOption({ label: "قرمز، بزرگ — ناموجود" });
  await expect(selectedOffer).toContainText("قیمت گونه انتخاب‌شده");
  await expect(page.getByText("۴۶۰٬۰۰۰ تومان", { exact: true })).toBeVisible();
  await expect(page.getByText("ناموجود", { exact: true }).last()).toBeVisible();
  await expect(page.getByLabel("تعداد")).toBeDisabled();
  await expect(page.getByRole("button", { name: "فعلاً ناموجود" })).toBeDisabled();
  await variantSelector.selectOption({ label: "قرمز، کوچک" });
  await expect(page.getByText("۴۵۷٬۰۰۰ تومان", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "افزودن به سبد" })).toBeEnabled();
  await expect(page.getByText("9", { exact: true })).toHaveCount(0);
  const publicStoreResponse = await page.request.get(`${e2eApiUrl}/v1/stores/${slug}`);
  const publicProductsResponse = await page.request.get(
    `${e2eApiUrl}/v1/stores/${slug}/products`,
  );
  const publicProductResponse = await page.request.get(
    `${e2eApiUrl}/v1/stores/${slug}/products/${new URL(page.url()).pathname.split("/").at(-1)}`,
  );
  expect(publicStoreResponse.ok()).toBe(true);
  expect(publicProductsResponse.ok()).toBe(true);
  expect(publicProductResponse.ok()).toBe(true);
  const publicSurface = `${storefrontHtml}\n${await page.content()}\n${JSON.stringify([
    await publicStoreResponse.json(),
    await publicProductsResponse.json(),
    await publicProductResponse.json(),
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
  await expect
    .poll(() =>
      page
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).complete),
        ),
    )
    .toBe(true);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page);
  await assertMinimumContrast(
    page.locator(
      "main h1, main p, main span, main strong, main label, main select, main button, main a",
    ),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .getByRole("button", { name: "افزودن به سبد" })
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).transitionDuration),
      ),
  ).toBeLessThan(0.001);
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

async function expectSellerWorkingMediaOrder(
  page: import("@playwright/test").Page,
  productId: string,
  expectedMediaIds: Array<string | undefined>,
) {
  const response = await page.request.get(`/api/store/seller/products/${productId}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    workingCopy: { orderedMediaIds: string[] };
  };
  expect(body.workingCopy.orderedMediaIds).toEqual(expectedMediaIds);
}

async function tabTo(
  page: import("@playwright/test").Page,
  target: import("@playwright/test").Locator,
) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}
