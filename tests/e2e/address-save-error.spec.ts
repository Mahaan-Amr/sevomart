import { expect, test } from "../helpers/release-playwright";

test("address save network failure keeps the form available for retry", async ({
  page,
}) => {
  await page.route("**/api/addresses", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { addresses: [] } });
    } else {
      await route.abort("failed");
    }
  });
  await page.goto("/account/addresses?returnTo=%2Fcheckout%2Fdelivery");
  await page.getByLabel("نام گیرنده").fill("خریدار نمونه");
  await page.getByLabel("شماره موبایل گیرنده").fill("09123456789");
  await page.getByLabel("استان").fill("تهران");
  await page.getByLabel("شهر").fill("تهران");
  await page.getByLabel("نشانی کامل").fill("خیابان نمونه، پلاک ۱۰");
  await page.getByRole("button", { name: "ذخیره نشانی" }).click();
  await expect(page.getByText("ارتباط برقرار نشد. دوباره تلاش کنید.")).toBeVisible();
  await expect(page.getByRole("button", { name: "ذخیره نشانی" })).toBeEnabled();
  await expect(page).toHaveURL(/\/account\/addresses/);
  await expect(page.getByLabel("نام گیرنده")).toHaveValue("خریدار نمونه");
});
