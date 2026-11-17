import { discoveryV1Examples } from "@sevo/contracts/discovery/v1";
import { expect, test } from "../helpers/release-playwright";

const item = discoveryV1Examples.DiscoveryFeedItemV1;
test("guest home shows a vertical image-led feed with real store and availability", async ({
  page,
}) => {
  await page.route("**/api/discovery*", (route) =>
    route.fulfill({
      json: {
        ...discoveryV1Examples.DiscoveryFeedPageV1,
        emptyState: undefined,
        items: [
          item,
          {
            ...item,
            productId: "00000002-5ad8-45d2-a126-b5b3412b3dd7",
            availability: "OUT_OF_STOCK",
            product: { ...item.product, name: "کالای دوم" },
          },
        ],
      },
    }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
  ).toBe(true);
  const posts = page.getByRole("listitem");
  await expect(posts).toHaveCount(2);
  await expect(
    posts.first().getByRole("link", { name: item.store.name }),
  ).toBeVisible();
  const card = posts.first().getByRole("article");
  const image = card.getByRole("link", { name: /دیدن.*گزینه/ }).locator("img");
  await expect(image).toBeVisible();
  const imageBounds = await image.boundingBox();
  expect(imageBounds?.width).toBe(imageBounds?.height);
  await expect(card).toHaveCSS("border-radius", "20px");
  await expect(card).toHaveCSS("border-inline-start-width", "1px");
  await expect(card).toHaveCSS("border-inline-end-width", "1px");
  await expect(posts.last()).toContainText("ناموجود");
  const first = await posts.nth(0).boundingBox();
  const second = await posts.nth(1).boundingBox();
  expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
  const imageLink = posts.first().getByRole("link", { name: /دیدن.*گزینه/ });
  await expect(imageLink).toHaveAttribute("href", new RegExp(item.productId));
  await imageLink.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await imageLink.focus();
  await expect(imageLink).toBeFocused();
  expect(
    await imageLink.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  await imageLink.click();
  await expect(page).toHaveURL(new RegExp(item.productId));
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(imageLink).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  const detail = posts.first().getByRole("link", { name: "دیدن کالا", exact: true });
  await detail.click();
  await expect(page).toHaveURL(new RegExp(item.productId));
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(detail).toBeFocused();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const lastDetail = posts.last().getByRole("link", { name: "دیدن کالا", exact: true });
  await expect(lastDetail).toBeInViewport();
  const lastDetailBottom = await lastDetail.evaluate(
    (element) => element.getBoundingClientRect().bottom,
  );
  const navigationTop = await page
    .getByRole("navigation", { name: "فضای خریدار" })
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(lastDetailBottom).toBeLessThanOrEqual(navigationTop);
});

test("signed-in buyer home displays followed products as vertical posts", async ({
  page,
}, testInfo) => {
  const { sellerBuyerTestMobiles, visualProjectIndex } =
    await import("../helpers/visual-projects");
  await page.goto("/login");
  await page
    .getByLabel("شماره موبایل")
    .fill(sellerBuyerTestMobiles[visualProjectIndex(testInfo.project.name)]!);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.route("**/api/following*", (route) =>
    route.fulfill({
      json: {
        ...discoveryV1Examples.FollowingFeedPageV1,
        emptyState: undefined,
        visibleFollowedStoreCount: 1,
        items: [
          item,
          {
            ...item,
            productId: "00000002-5ad8-45d2-a126-b5b3412b3dd7",
            product: { ...item.product, name: "کالای دوم" },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  const posts = page
    .getByRole("region", { name: "فید دنبال‌شده‌ها" })
    .getByRole("listitem");
  await expect(posts).toHaveCount(2);
  const first = await posts.nth(0).boundingBox();
  const second = await posts.nth(1).boundingBox();
  expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
});

test("home theme switches with the keyboard, survives reloading, and stays scoped to home", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto("/");
  const header = page.getByRole("banner");
  const navigation = page.getByRole("navigation", { name: "فضای خریدار" });
  const enableDark = header.getByRole("button", { name: "حالت تاریک" });
  const enableLight = header.getByRole("button", { name: "حالت روشن" });
  const body = page.locator("body");
  const lightNavigation = await navigation.evaluate(
    (element) => getComputedStyle(element).background,
  );

  await expect(enableDark).toBeVisible({ timeout: 5000 });
  await expect(body).toHaveCSS("color-scheme", "light");
  await header.getByRole("link", { name: "سبد" }).focus();
  await page.keyboard.press("Tab");
  await expect(enableDark).toBeFocused();
  await expect(enableDark).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/$/);
  await expect(enableLight).toBeFocused();
  await expect(body).toHaveCSS("color-scheme", "dark");
  await expect(navigation).toHaveCSS("background-color", "rgb(34, 34, 34)");

  await page.reload();
  await expect(enableLight).toBeVisible();
  await expect(body).toHaveCSS("color-scheme", "dark");

  await navigation.getByRole("link", { name: "کشف", exact: true }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(enableLight).toHaveCount(0);
  await expect(body).toHaveCSS("color-scheme", "light");
  await expect(navigation).toHaveCSS("background", lightNavigation);

  await navigation.getByRole("link", { name: "خانه", exact: true }).click();
  await expect(enableLight).toBeVisible();
  await expect(body).toHaveCSS("color-scheme", "dark");
  await enableLight.click();
  await page.reload();
  await expect(enableDark).toBeVisible();
  await expect(body).toHaveCSS("color-scheme", "light");
});
