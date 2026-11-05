import { expect, test } from "../helpers/release-playwright";

test("login waits for hydration before accepting input and sends the entered mobile", async ({
  page,
}) => {
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route("**/_next/static/**/*.js", async (route) => {
    await scriptsReady;
    await route.continue();
  });
  const mobile = page.getByLabel("شماره موبایل");
  const submit = page.getByRole("button", { name: "دریافت کد" });
  try {
    await page.goto("/login?next=/", { waitUntil: "commit" });
    await expect(mobile).toBeVisible();
    await expect(mobile).toBeDisabled();
    await expect(submit).toBeDisabled();
  } finally {
    releaseScripts();
  }
  await expect(mobile).toBeEditable();
  const syntheticMobile = "09123456789";
  await mobile.fill(syntheticMobile);
  const request = page.waitForRequest("**/api/auth/otp/requests");
  await submit.click();
  expect((await request).postDataJSON().mobile === syntheticMobile).toBe(true);
  await expect(page.getByLabel("کد شش‌رقمی")).toBeVisible();
});

test("signed-in user can end sessions on all devices", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("شماره موبایل").fill("09123456789");
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: /ورود/ }).click();
  await page.waitForURL("/");
  await page.goto("/login?manage=1");
  await expect(
    page.getByRole("button", { name: "خروج از همه دستگاه‌ها" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "خروج از همه دستگاه‌ها" }).click();
  await expect(page.getByLabel("شماره موبایل")).toBeVisible();
});
