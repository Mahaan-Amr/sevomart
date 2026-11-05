import { expect, test } from "../helpers/release-playwright";
import { assertNoHorizontalOverflow } from "../helpers/visual-assertions";

test("a prospective seller can explore the introduction and start an application", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/seller/start");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "فروشگاه خودتان در سوو" }),
  ).toBeVisible();
  await expect(
    page.getByText("ثبت درخواست به معنی تأیید خودکار فروشندگی نیست"),
  ).toBeVisible();
  await page.getByRole("button", { name: "بعدی" }).click();
  await expect(
    page.getByRole("heading", { name: "فروش با مسئولیت روشن" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "قبلی" }).click();
  await expect(
    page.getByRole("heading", { name: "فروشگاه خودتان در سوو" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /مرحله 3:/ }).click();
  await expect(
    page.getByText(
      "تسویه مستقیم است. سوو مشکل را پیگیری می‌کند، اما بازپرداخت را تضمین نمی‌کند.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "شروع درخواست فروشندگی" }).click();
  await expect(page).toHaveURL(/\/seller\/login\?returnTo=%2Fseller%2Fapplication/);
});

test("the introduction remains accessible with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/seller/start");
  await assertNoHorizontalOverflow(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "سوو" })).toBeFocused();
  await expect(page.getByRole("link", { name: "سوو" })).toHaveCSS(
    "outline-style",
    "solid",
  );
  const image = page.locator("main").locator("div").first();
  const background = await image.evaluate(
    (element) => getComputedStyle(element).backgroundImage,
  );
  expect(background).toContain("/seller/workshop.png");
  const response = await page.request.get("/seller/workshop.png");
  expect(response.ok()).toBe(true);
  await expect(image).toHaveCSS("transition-duration", "0s");
  await page.getByRole("button", { name: "بعدی" }).click();
  await expect(
    page.getByRole("heading", { name: "فروش با مسئولیت روشن" }),
  ).toBeVisible();
});
