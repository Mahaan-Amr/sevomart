import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("seller builds, refreshes, previews and publishes a minimal store", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-390x844");
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  await sql`delete from store_stores`;
  await sql.end();

  await page.goto("/seller/login");
  await page.getByLabel("شماره موبایل").fill("09111111111");
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await page.getByRole("link", { name: "ساخت فروشگاه" }).click();

  await page.getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" }).click();
  await expect(page.getByText("نام فروشگاه را کامل‌تر بنویسید.")).toBeVisible();
  await expect(page.getByText("شرایط مرجوعی را کمی روشن‌تر بنویسید.")).toBeVisible();

  await page.getByLabel("نام فروشگاه").fill("خانه سفال ماه");
  await page.getByLabel("شناسه لینک").fill("e2e-khane-mah");
  await page.getByLabel("معرفی کوتاه").fill("سفال دست‌ساز برای خانه‌های گرم و ساده");
  await page
    .getByLabel("سیاست مرجوعی")
    .fill("تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.");
  await page.getByText("ظاهر فروشگاه (اختیاری)").click();
  await page.getByLabel("لوگو").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" }).click();

  await expect(page.getByRole("heading", { name: "پیش‌نمایش فروشگاه" })).toBeVisible();
  await expect(page.getByText(/تأیید آزمایشی؛ بدون تضمین/)).toBeVisible();
  await expect(page.getByText(/ساخته‌شده با سوو/)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("نام فروشگاه")).toHaveValue("خانه سفال ماه");
  await page.getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" }).click();
  await page.getByRole("button", { name: "انتشار فروشگاه" }).click();

  await expect(page.getByRole("heading", { name: "فروشگاه آماده است" })).toBeVisible();
  await expect(page.getByText("/s/e2e-khane-mah", { exact: true })).toBeVisible();
});
