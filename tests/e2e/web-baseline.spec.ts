import { expect, test } from "@playwright/test";

function luminance(rgb: string): number {
  const channels = rgb.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

test("the web baseline is Persian, accessible, and right-to-left", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "سوو در حال آماده‌شدن است" }),
  ).toBeVisible();

  expect(
    await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      Array.from(document.styleSheets).some((sheet) =>
        Array.from(sheet.cssRules).some((rule) =>
          rule.cssText.includes("prefers-reduced-motion: reduce"),
        ),
      ),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.fonts.check('16px "Yekan Bakh"'))).toBe(
    true,
  );

  for (const locator of [page.getByRole("heading"), page.locator(".status p")]) {
    const colors = await locator.evaluate((element) => {
      const foreground = getComputedStyle(element).color;
      const background = getComputedStyle(element.closest(".status")!).backgroundColor;
      return { foreground, background };
    });
    const lighter = Math.max(
      luminance(colors.foreground),
      luminance(colors.background),
    );
    const darker = Math.min(luminance(colors.foreground), luminance(colors.background));
    expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});
