import { expect, test } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  acceptanceTestMobiles,
  deterministicScreenshotOptions,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("seller builds, refreshes, previews and publishes a minimal store", async ({
  page,
}, testInfo) => {
  const projectIndex = visualProjectIndex(testInfo.project.name);
  const mobile = acceptanceTestMobiles[projectIndex];
  if (!mobile) throw new Error(`Missing acceptance mobile for project ${projectIndex}`);
  const slug = `e2e-builder-${projectIndex}`;
  const storeName = "فروشگاه دست‌سازه‌های کوچک و دوست‌داشتنی ماه‌نقره‌ای تهران";
  const storeBio =
    "اینجا هر دست‌سازه با حوصله و در شمار محدود آماده می‌شود؛ توضیح روشن کمک می‌کند پیش از سفارش بدانید چه چیزی به دستتان می‌رسد.";
  const returnPolicy =
    "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد؛ برای پیگیری، مشکل را از جزئیات سفارش ثبت کنید.";
  const publishedReturnPolicy =
    "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.";
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  await sql`
    delete from store_stores
    where id in (
      select membership.store_id
      from store_memberships membership
      join identity_login_methods method on method.identity_id = membership.seller_id
      where method.mobile = ${mobile}
    )
    or slug = ${slug}
  `;
  await page.goto("/seller/login?returnTo=%2Fseller%2Fstore%2Fsetup");
  await expect(page.getByRole("heading", { name: "ورود به سوو" })).toBeVisible();
  await expect(page).toHaveScreenshot(
    "seller-login.png",
    deterministicScreenshotOptions,
  );
  const mobileInput = page.getByLabel("شماره موبایل");
  await mobileInput.focus();
  await mobileInput.fill(mobile);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "دریافت کد" })).toBeFocused();
  await page.keyboard.press("Enter");
  const codeInput = page.getByLabel("کد شش‌رقمی");
  await expect(codeInput).toBeFocused();
  await codeInput.fill("111111");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "ورود" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "ادامه کار" })).toBeVisible();
  const identities = await sql<Array<{ identityId: string }>>`
    select identity_id as "identityId" from identity_login_methods where mobile = ${mobile}
  `;
  const identityId = identities[0]?.identityId;
  if (!identityId) throw new Error("store builder identity was not created");
  await sql`
    insert into identity_seller_access (id, identity_id, status)
    values (${crypto.randomUUID()}, ${identityId}, 'ACTIVE')
    on conflict (identity_id) do update set status = 'ACTIVE'
  `;
  await sql.end();
  const builderLink = page.getByRole("link", { name: "ادامه کار" });
  await builderLink.focus();
  await page.keyboard.press("Enter");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const storeNameInput = page.getByLabel("نام فروشگاه");
  await storeNameInput.fill("پیش‌نویس خانه ماه");
  await page.getByRole("button", { name: "ذخیره و خروج" }).click();
  await expect(page).toHaveURL(/\/seller\/store$/);
  await expect(page.getByText("پیش‌نویس فروشگاه ذخیره شده است")).toBeVisible();
  for (const [path, heading, firstControl] of [
    ["profile", "معرفی فروشگاه", "نام فروشگاه"],
    ["shipping", "روش‌های ارسال", "پست پیشتاز"],
    ["returns", "شرایط مرجوعی", "سیاست مرجوعی"],
    ["appearance", "ظاهر فروشگاه", "رنگ فروشگاه"],
  ] as const) {
    await page.goto(`/seller/store/${path}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByRole("button", { name: "ذخیره و خروج" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await assertNoHorizontalOverflow(page);
    await assertInteractiveTargets(
      page,
      path === "shipping"
        ? "a, button, input:not([type=checkbox]), select, summary, textarea"
        : undefined,
    );
    if (path === "shipping") {
      for (const checkbox of await page.getByRole("checkbox").all()) {
        expect(
          await checkbox.evaluate(
            (element) => element.closest("label")?.getBoundingClientRect().height ?? 0,
          ),
        ).toBeGreaterThanOrEqual(40);
      }
    }
    await assertMinimumContrast(
      page
        .getByRole("heading", { name: heading })
        .or(page.getByRole("button", { name: "ذخیره و خروج" })),
    );
    const back = page.getByRole("link", { name: "بازگشت به وضعیت فروشگاه" });
    await back.focus();
    await page.keyboard.press("Tab");
    if (path === "shipping") {
      await expect(page.getByRole("checkbox", { name: firstControl })).toBeFocused();
    } else {
      await expect(page.getByLabel(firstControl)).toBeFocused();
    }
  }

  await page.goto("/seller/store/profile");
  await expect(page.getByLabel("نام فروشگاه")).toHaveValue("پیش‌نویس خانه ماه");
  await page.getByRole("button", { name: "ذخیره و خروج" }).click();
  await expect(
    page.getByText("شناسه لینک باید دست‌کم سه نویسه و با قالب نمونه باشد."),
  ).toBeVisible();
  await expect(page.getByText("یک معرفی کوتاه برای فروشگاه بنویسید.")).toBeVisible();
  await expect(page).toHaveURL(/\/seller\/store\/profile$/);
  await page.getByLabel("نام فروشگاه").fill(storeName);
  await page.getByLabel("شناسه لینک").fill(slug);
  await page.getByLabel("معرفی کوتاه").fill(storeBio);
  await page.getByLabel("شناسه لینک").blur();
  await expect(page.getByText("این شناسه لینک در دسترس است.")).toBeVisible();
  await page.getByRole("button", { name: "ذخیره و خروج" }).click();
  await expect(page).toHaveURL(/\/seller\/store$/);
  await page.goto("/seller/store/profile");
  await expect(page.getByLabel("معرفی کوتاه")).toHaveValue(storeBio);

  await page.goto("/seller/store/shipping");
  let nationalPost = page.getByRole("group", { name: "پست پیشتاز" });
  await nationalPost
    .getByLabel("عنوانی که خریدار می‌بیند")
    .fill("پست پیشتاز با تحویل قابل پیگیری در سراسر ایران");
  await nationalPost.getByLabel("هزینه ارسال (تومان)").fill("-۱");
  await page.getByRole("button", { name: "ذخیره و خروج" }).click();
  await expect(
    nationalPost.getByText("هزینه را با عدد فارسی یا انگلیسی و بدون جداکننده بنویسید."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/seller\/store\/shipping$/);
  await nationalPost.getByLabel("هزینه ارسال (تومان)").fill("۸۵۰۰۰");
  await nationalPost
    .getByLabel("زمان تقریبی تحویل")
    .fill("سه تا پنج روز کاری پس از آماده‌سازی سفارش");
  await page.getByRole("button", { name: "ذخیره و خروج" }).click();
  await expect(page).toHaveURL(/\/seller\/store$/);
  await page.goto("/seller/store/shipping");
  nationalPost = page.getByRole("group", { name: "پست پیشتاز" });
  await expect(nationalPost.getByLabel("هزینه ارسال (تومان)")).toHaveValue("85000");
  await expect(nationalPost.getByLabel("زمان تقریبی تحویل")).toHaveValue(
    "سه تا پنج روز کاری پس از آماده‌سازی سفارش",
  );
  await nationalPost.getByLabel("عنوانی که خریدار می‌بیند").fill("پست پیشتاز");
  await nationalPost.getByLabel("هزینه ارسال (تومان)").fill("۰");
  await nationalPost
    .getByLabel("زمان تقریبی تحویل")
    .fill("زمان دقیق ارسال هنگام ثبت سفارش مشخص می‌شود.");
  await page.getByRole("button", { name: "ذخیره و خروج" }).click();
  await expect(page).toHaveURL(/\/seller\/store$/);

  await page.goto("/seller/store/returns");
  await page.getByLabel("سیاست مرجوعی").fill(returnPolicy);
  await page.getByRole("button", { name: "ذخیره و خروج" }).click();
  await expect(page).toHaveURL(/\/seller\/store$/);
  await page.goto("/seller/store/returns");
  await expect(page.getByLabel("سیاست مرجوعی")).toHaveValue(returnPolicy);
  await page.getByLabel("سیاست مرجوعی").fill(publishedReturnPolicy);
  await page.getByRole("button", { name: "ذخیره و خروج" }).click();
  await expect(page).toHaveURL(/\/seller\/store$/);

  await page.goto("/seller/store/appearance");
  await page.getByLabel("رنگ فروشگاه").fill("#760B29");
  await expect(
    page
      .getByRole("article", { name: "پیش‌نمایش زنده فروشگاه" })
      .locator("div")
      .first(),
  ).toHaveCSS("background-color", "rgb(118, 11, 41)");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .getByRole("button", { name: "ذخیره و خروج" })
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).transitionDuration),
      ),
  ).toBeLessThanOrEqual(0.00001);
  await page.getByRole("button", { name: "ذخیره و خروج" }).click();
  await expect(page).toHaveURL(/\/seller\/store$/);
  await page.goto("/seller/store/appearance");
  await expect(page.getByLabel("رنگ فروشگاه")).toHaveValue("#760b29");

  await page.goto("/seller/store");
  await page.getByRole("link", { name: "ادامه راه‌اندازی" }).click();
  await expect(page.getByText("قدم ۱ از ۳")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "بازگشت به وضعیت فروشگاه" }),
  ).toBeVisible();
  await expect(page.getByLabel("نام فروشگاه")).toHaveValue(storeName);
  await page.getByLabel("نام فروشگاه").clear();
  await page.getByLabel("شناسه لینک").clear();
  await page.getByLabel("معرفی کوتاه").clear();
  await storeNameInput.focus();
  await expect(storeNameInput).toBeFocused();
  await expect(storeNameInput).toHaveCSS("outline-style", "solid");
  for (const nextControl of [
    page.getByLabel("شناسه لینک"),
    page.getByLabel("معرفی کوتاه"),
    page.getByRole("button", { name: "ادامه" }),
  ]) {
    await page.keyboard.press("Tab");
    await expect(nextControl).toBeFocused();
  }

  const viewport = testInfo.project.use.viewport;
  if (!viewport) throw new Error("The visual project must declare a viewport");
  await page.setViewportSize({
    width: Math.floor(viewport.width / 2),
    height: Math.floor(viewport.height / 2),
  });
  await assertNoHorizontalOverflow(page);
  await page.setViewportSize(viewport);

  await page.keyboard.press("Enter");
  await expect(page.getByText("نام فروشگاه را کامل‌تر بنویسید.")).toBeVisible();
  await expect(page).toHaveScreenshot(
    "store-validation-error.png",
    deterministicScreenshotOptions,
  );

  await page.getByLabel("نام فروشگاه").fill(storeName);
  await page.getByLabel("شناسه لینک").fill(slug);
  await page.getByLabel("معرفی کوتاه").fill(storeBio);
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByText("قدم ۲ از ۳")).toBeVisible();
  await page.getByLabel("سیاست مرجوعی").fill(publishedReturnPolicy);
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByText("قدم ۳ از ۳")).toBeVisible();
  for (const validationMessage of [
    "نام فروشگاه را کامل‌تر بنویسید.",
    "شناسه لینک باید دست‌کم سه نویسه و با قالب نمونه باشد.",
    "یک معرفی کوتاه برای فروشگاه بنویسید.",
    "شرایط مرجوعی را کمی روشن‌تر بنویسید.",
  ]) {
    await expect(page.getByText(validationMessage)).toHaveCount(0);
  }
  const livePreview = page.getByRole("article", {
    name: "پیش‌نمایش زنده فروشگاه",
  });
  await page.getByLabel("رنگ فروشگاه").fill("#760B29");
  await expect(livePreview.locator("div").first()).toHaveCSS(
    "background-color",
    "rgb(118, 11, 41)",
  );
  const logo = await sharp({
    create: { width: 256, height: 256, channels: 4, background: "#760B29" },
  })
    .png()
    .toBuffer();
  const cover = await sharp({
    create: { width: 1200, height: 400, channels: 4, background: "#EEC8D3" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("لوگو").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: logo,
  });
  await page.getByLabel("تصویر روی جلد").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: cover,
  });
  await expect(page.getByText("انتخاب فایل")).toHaveCount(2);
  await expect(page.getByText("logo.png")).toBeVisible();
  await expect(page.getByText("cover.png")).toBeVisible();
  await expect(livePreview.getByRole("img", { name: "پیش‌نمایش لوگو" })).toBeVisible();
  await expect(
    livePreview.getByRole("img", { name: "پیش‌نمایش تصویر روی جلد" }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page);
  await assertMinimumContrast(
    page
      .getByRole("heading", { name: "ساخت فروشگاه" })
      .or(
        page.getByText("اطلاعاتی را وارد کنید که خریدار پیش از تصمیم‌گیری باید بداند."),
      )
      .or(page.getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" })),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" })
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).transitionDuration),
      ),
  ).toBeLessThanOrEqual(0.00001);
  await expect(page).toHaveScreenshot(
    "store-customized-long-content.png",
    deterministicScreenshotOptions,
  );
  await page.getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "پیش‌نمایش فروشگاه" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/تأیید آزمایشی؛ بدون تضمین/)).toBeVisible();
  await expect(page.getByText(/ساخته‌شده با سوو/)).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page);
  await assertMinimumContrast(
    page
      .getByRole("heading", { name: "پیش‌نمایش فروشگاه" })
      .or(page.getByText(/تأیید آزمایشی؛ بدون تضمین/))
      .or(page.getByRole("button", { name: "انتشار فروشگاه" })),
  );
  await expect(page).toHaveScreenshot(
    "store-preview.png",
    deterministicScreenshotOptions,
  );

  await page.reload();
  await expect(page.getByLabel("نام فروشگاه")).toHaveValue(storeName);
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByText("قدم ۲ از ۳")).toBeVisible();
  await page.getByRole("button", { name: "ادامه" }).click();
  await expect(page.getByText("قدم ۳ از ۳")).toBeVisible();
  await expect(
    page.getByRole("article", { name: "پیش‌نمایش زنده فروشگاه" }).getByRole("img", {
      name: "پیش‌نمایش لوگو",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "پیش‌نمایش زنده فروشگاه" }).getByRole("img", {
      name: "پیش‌نمایش تصویر روی جلد",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" }).focus();
  await page.keyboard.press("Enter");
  const backButton = page.getByRole("button", { name: "برگشت و ویرایش" });
  await expect(backButton).toBeVisible({ timeout: 15_000 });
  await page.route("**/api/store/seller/store/publication", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        code: "VALIDATION_ERROR",
        message: "برای انتشار، اطلاعات ضروری فروشگاه را کامل کنید.",
        correlationId: "store-builder-e2e",
        details: {
          issues: [
            { field: "shipping_method", code: "REQUIRED" },
            { field: "return_policy", code: "REQUIRED" },
            { field: "slug", code: "REQUIRED" },
            { field: "settlement_destination", code: "REQUIRED" },
          ],
        },
      }),
    });
  });
  await backButton.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "انتشار فروشگاه" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(
      "برای انتشار این بخش‌ها را کامل کنید: روش ارسال فعال، سیاست مرجوعی، شناسه لینک، مقصد تسویه.",
    ),
  ).toBeVisible();
  await page.unroute("**/api/store/seller/store/publication");
  await page.getByRole("button", { name: "انتشار فروشگاه" }).click();

  await expect(page.getByRole("heading", { name: "فروشگاه آماده است" })).toBeVisible();
  await expect(page.getByText(`/s/${slug}`, { exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page);
  await expect(page).toHaveScreenshot(
    "store-published.png",
    deterministicScreenshotOptions,
  );

  await page.goto(`/s/${slug}`);
  await page.reload();
  await expect(page.getByRole("heading", { name: storeName })).toBeVisible();
  await expect(page.getByText(storeBio)).toBeVisible();
  await expect(page.getByText(/تا هفت روز پس از تحویل/)).toBeVisible();
  await expect(page.getByText("ساخته‌شده با سوو")).toBeVisible();
  await expect(page.locator("img")).toHaveCount(2);
  for (const image of await page.locator("img").all()) {
    await expect(image).toHaveJSProperty("complete", true);
  }
  await expect(page).toHaveScreenshot(
    "guest-storefront-after-refresh.png",
    deterministicScreenshotOptions,
  );
});
