import { expect, test } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

const projectIndexes: Record<string, number> = {
  "chromium-360x800": 0,
  "chromium-390x844": 1,
  "chromium-768x1024": 2,
  "chromium-1440x900": 3,
};

test("seller builds, refreshes, previews and publishes a minimal store", async ({
  page,
}, testInfo) => {
  const projectIndex = projectIndexes[testInfo.project.name];
  if (projectIndex === undefined) {
    throw new Error(`Unknown project ${testInfo.project.name}`);
  }
  const mobile = `09111111${String(30 + projectIndex).padStart(3, "0")}`;
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
      join identity_sellers seller on seller.id = membership.seller_id
      where seller.mobile = ${mobile}
    )
  `;
  await sql.end();

  await page.goto("/seller/login");
  await expect(
    page.getByRole("heading", { name: "ورود به فضای فروشنده" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("seller-login.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.015,
  });
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await page.getByRole("link", { name: "ساخت فروشگاه" }).click();

  await page.getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" }).click();
  await expect(page.getByText("نام فروشگاه را کامل‌تر بنویسید.")).toBeVisible();
  await expect(page.getByText("شرایط مرجوعی را کمی روشن‌تر بنویسید.")).toBeVisible();
  await expect(page).toHaveScreenshot("store-validation-error.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.015,
  });

  await page.getByLabel("نام فروشگاه").fill(storeName);
  await page.getByLabel("شناسه لینک").fill(slug);
  await page.getByLabel("معرفی کوتاه").fill(storeBio);
  await page
    .getByLabel("سیاست مرجوعی")
    .fill("تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.");
  await page.getByText("ظاهر فروشگاه (اختیاری)").click();
  await page.getByLabel("رنگ فروشگاه").fill("#760B29");
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
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
  ).toBe(false);
  await expect(page).toHaveScreenshot("store-customized-long-content.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.015,
  });
  await page.getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" }).click();

  await expect(page.getByRole("heading", { name: "پیش‌نمایش فروشگاه" })).toBeVisible();
  await expect(page.getByText(/تأیید آزمایشی؛ بدون تضمین/)).toBeVisible();
  await expect(page.getByText(/ساخته‌شده با سوو/)).toBeVisible();
  await expect(page).toHaveScreenshot("store-preview.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.015,
  });

  await page.reload();
  await expect(page.getByLabel("نام فروشگاه")).toHaveValue(storeName);
  await page.getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" }).click();
  await page.getByRole("button", { name: "انتشار فروشگاه" }).click();

  await expect(page.getByRole("heading", { name: "فروشگاه آماده است" })).toBeVisible();
  await expect(page.getByText(`/s/${slug}`, { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("store-published.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.015,
  });

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
  await expect(page).toHaveScreenshot("guest-storefront-after-refresh.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.015,
  });
});
