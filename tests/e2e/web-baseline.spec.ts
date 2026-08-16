import { expect, test } from "@playwright/test";

import { contrastRatio } from "../helpers/color-contrast";

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
    expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(
      4.5,
    );
  }
});
