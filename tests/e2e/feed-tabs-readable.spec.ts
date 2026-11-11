import { expect, test } from "../helpers/release-playwright";

test("feed tabs remain readable and keyboard accessible", async ({ page }) => {
  await page.goto("/discover");
  const tabs = page.getByRole("navigation", { name: "فید فروشگاه‌ها" });
  const discovery = tabs.getByRole("link", { name: "کشف" });
  const following = tabs.getByRole("link", { name: "دنبال‌شده‌ها" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(following).toHaveCSS("white-space", "nowrap");
  const first = await discovery.boundingBox();
  const second = await following.boundingBox();
  expect(first!.width).toBeGreaterThanOrEqual(44);
  expect(second!.width).toBeGreaterThanOrEqual(44);
  expect(Math.abs(first!.width - second!.width)).toBeLessThan(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await following.focus();
  await expect(following).toBeFocused();
  expect(
    await following.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
});
