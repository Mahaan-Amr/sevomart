import { expect, test } from "@playwright/test";
import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";

test("guest browses discovery and finds seller entry in the identity menu", async ({
  page,
}) => {
  await page.goto("/discover");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const products = page
    .getByRole("list", { name: "کالاهای تازه" })
    .getByRole("listitem");
  await expect(products).toHaveCount(3);
  expect(
    new Set(
      await products.evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().top),
      ),
    ).size,
  ).toBe(1);
  const identity = page.locator("summary").filter({ hasText: "هویت سوو" });
  await identity.focus();
  await page.keyboard.press("Enter");
  const entry = page.getByRole("banner").getByRole("link", { name: "فروشنده شوید" });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute("href", "/seller/start");
  await page.keyboard.press("Tab");
  await expect(entry).toBeFocused();
  await assertNoHorizontalOverflow(page);
  await assertMinimumContrast(page.locator("main h1, main strong, main h2 a"));
});

test("signed-in buyer finds seller entry in the identity menu while browsing discovery", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "buyer", value: "1", url: "http://127.0.0.1:3339" },
  ]);
  await page.goto("/discover");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const products = page
    .getByRole("list", { name: "کالاهای تازه" })
    .getByRole("listitem");
  await expect(products).toHaveCount(3);
  expect(
    new Set(
      await products.evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().top),
      ),
    ).size,
  ).toBe(1);
  const identity = page.locator("summary").filter({ hasText: "۰۹۱۲***۶۷۸۹" });
  await identity.focus();
  await page.keyboard.press("Enter");
  const entry = page
    .getByRole("banner")
    .getByRole("link", { name: "درخواست فروشندگی" });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute("href", "/seller/start");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("banner").getByRole("link", { name: "سفارش‌ها" }),
  ).toBeFocused();
  await assertNoHorizontalOverflow(page);
  await assertMinimumContrast(page.locator("main h1, main strong, main h2 a"));
});

test("storefront displays three readable product columns with keyboard access", async ({
  page,
}) => {
  await page.goto("/s/khane-sofal-mah");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const section = page.getByRole("region", { name: "کالاهای فروشگاه" });
  const cards = section.locator("article");
  await expect(cards).toHaveCount(3);
  expect(
    new Set(
      await cards.evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().top),
      ),
    ).size,
  ).toBe(1);
  const link = section.getByRole("link", { name: /دیدن فنجان دست‌ساز.*1/ }).first();
  await link.focus();
  await expect(link).toBeFocused();
  await expect(link).toHaveAttribute("href", /\/products\//);
  await assertNoHorizontalOverflow(page);
  await assertMinimumContrast(section.locator("h2, strong, a"));
});
