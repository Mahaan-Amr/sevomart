import { discoveryV1Examples } from "@sevo/contracts/discovery/v1";
import { contrastRatio } from "../helpers/color-contrast";
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
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const navigation = page.getByRole("navigation", { name: "فضای خریدار" });
  const indicator = navigation.locator(":scope > span[aria-hidden=true]");
  const reflection = indicator.locator("span");
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "smooth");
  await expect(indicator).toHaveCSS("transition-property", "transform, opacity");
  await expect(reflection).not.toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
  await expect(indicator).toHaveCSS("transition-property", "none");
  await expect(reflection).toHaveCSS("animation-name", "none");
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
  await page.getByRole("banner").locator("summary").focus();
  await page.keyboard.press("Tab");
  const firstStore = card.getByRole("link", { name: item.store.name });
  await expect(firstStore).toBeFocused();
  expect((await firstStore.boundingBox())!.y).toBeGreaterThanOrEqual(
    (await page.getByRole("banner").boundingBox())!.height,
  );
  await page.keyboard.press("Tab");
  await expect(imageLink).toBeFocused();
  await imageLink.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
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

  const lastPost = posts.last();
  await lastPost.getByRole("heading").getByRole("link").focus();
  await page.keyboard.press("Tab");
  const lastDetail = lastPost.getByRole("link", { name: "دیدن کالا", exact: true });
  await expect(lastDetail).toBeFocused();
  await expect(lastDetail).toBeInViewport();
  const lastDetailBottom = await lastDetail.evaluate(
    (element) => element.getBoundingClientRect().bottom,
  );
  const navigationTop = await navigation.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(lastDetailBottom).toBeLessThanOrEqual(navigationTop);

  await page.setViewportSize({ width: 240, height: 800 });
  const { headerBottom, scrollPadding } = await page
    .getByRole("banner")
    .evaluate((element) => ({
      headerBottom: element.getBoundingClientRect().bottom,
      scrollPadding: parseFloat(
        getComputedStyle(document.documentElement).scrollPaddingBlockStart,
      ),
    }));
  expect(scrollPadding).toBeGreaterThanOrEqual(headerBottom);
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

test("home theme switch keeps the same appearance on other pages and reloads", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.route("**/api/discovery*", (route) =>
    route.fulfill({
      json: {
        ...discoveryV1Examples.DiscoveryFeedPageV1,
        emptyState: undefined,
        items: [item],
      },
    }),
  );
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
  const discover = navigation.getByRole("link", { name: "کشف", exact: true });
  await discover.hover();
  await expect(discover.getByText("کشف", { exact: true })).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await header.getByRole("link", { name: "سبد" }).focus();
  await page.keyboard.press("Tab");
  await expect(enableDark).toBeFocused();
  await expect(enableDark).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/$/);
  await expect(enableLight).toBeFocused();
  await expect(body).toHaveCSS("color-scheme", "dark");
  await expect(navigation).toHaveCSS("background-color", "rgb(34, 34, 34)");
  await expect(navigation).toHaveCSS(
    "box-shadow",
    "rgba(0, 0, 0, 0.4) 0px 6px 26px 0px",
  );

  const headerSurface = await header.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const dockSurface = await navigation.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const card = page.getByRole("listitem").first().getByRole("article");
  const cardSurface = await card.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const titleColor = await card
    .getByRole("heading")
    .getByRole("link")
    .evaluate((element) => getComputedStyle(element).color);
  const detail = await card
    .getByRole("link", { name: "دیدن کالا", exact: true })
    .evaluate((element) => {
      const { backgroundColor, color } = getComputedStyle(element);
      return { backgroundColor, color };
    });
  const dockText = await navigation
    .getByRole("link", { name: "کشف", exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  const focusColor = await enableLight.evaluate(
    (element) => getComputedStyle(element).outlineColor,
  );
  expect(contrastRatio(titleColor, cardSurface)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(detail.color, detail.backgroundColor)).toBeGreaterThanOrEqual(
    4.5,
  );
  expect(contrastRatio(dockText, dockSurface)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(focusColor, headerSurface)).toBeGreaterThanOrEqual(3);

  await page.reload();
  await expect(enableLight).toBeVisible();
  await expect(body).toHaveCSS("color-scheme", "dark");

  await discover.click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(enableLight).toHaveCount(0);
  await expect(body).toHaveCSS("color-scheme", "dark");
  await expect(navigation).toHaveCSS("background-color", "rgb(34, 34, 34)");

  await navigation.getByRole("link", { name: "خانه", exact: true }).click();
  await expect(enableLight).toBeVisible();
  await card.getByRole("link", { name: "دیدن کالا", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(item.productId));
  await expect(body).toHaveCSS("background-color", "rgb(18, 18, 18)");
  await page.goBack();
  await expect(enableLight).toBeVisible();

  for (const route of ["/cart", "/login", "/seller/login", "/platform/login"]) {
    await page.goto(route);
    await expect(body).toHaveCSS("color-scheme", "dark");
    await expect(body).toHaveCSS("background-color", "rgb(18, 18, 18)");
    await expect(enableLight).toHaveCount(0);
  }

  await page.goto("/");
  await expect(enableLight).toBeVisible();
  await expect(body).toHaveCSS("color-scheme", "dark");
  await enableLight.click();
  await page.reload();
  await expect(enableDark).toBeVisible();
  await expect(body).toHaveCSS("color-scheme", "light");
  await expect(navigation).toHaveCSS("background", lightNavigation);
});
