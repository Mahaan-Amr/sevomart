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
  await page.getByRole("link", { name: "ادامه راه‌اندازی" }).click();
  await expect(page.getByText("قدم ۱ از ۳")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "بازگشت به وضعیت فروشگاه" }),
  ).toBeVisible();
  await expect(page.getByLabel("نام فروشگاه")).toHaveValue("پیش‌نویس خانه ماه");
  await page.getByLabel("نام فروشگاه").clear();
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
  await page
    .getByLabel("سیاست مرجوعی")
    .fill("تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.");
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
  await backButton.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "انتشار فروشگاه" })).toBeFocused();
  await page.keyboard.press("Enter");

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
