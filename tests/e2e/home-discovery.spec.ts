import { expect, test } from "../helpers/release-playwright";

test("guest can move between home and public discovery and return", async ({
  page,
}) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "فضای خریدار" });
  await expect(navigation.getByRole("link", { name: "خانه" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("region", { name: "فید کشف" })).toBeVisible();
  await navigation.getByRole("link", { name: "کشف" }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(navigation.getByRole("link", { name: "کشف" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const tabs = page.getByRole("navigation", { name: "فید فروشگاه‌ها" });
  await expect(tabs.getByRole("link", { name: "دنبال‌شده‌ها" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(navigation.getByRole("link", { name: "خانه" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("signed-in buyer sees followed stores at home and public discovery separately", async ({
  page,
}, testInfo) => {
  const { sellerBuyerTestMobiles, visualProjectIndex } =
    await import("../helpers/visual-projects");
  const { discoveryV1Examples } = await import("@sevo/contracts/discovery/v1");
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
          {
            ...discoveryV1Examples.DiscoveryFeedItemV1,
            product: {
              ...discoveryV1Examples.DiscoveryFeedItemV1.product,
              name: "کالای فروشگاه دنبال‌شده",
            },
          },
        ],
      },
    }),
  );
  await page.route("**/api/discovery*", (route) =>
    route.fulfill({
      json: {
        ...discoveryV1Examples.DiscoveryFeedPageV1,
        emptyState: undefined,
        items: [
          {
            ...discoveryV1Examples.DiscoveryFeedItemV1,
            product: {
              ...discoveryV1Examples.DiscoveryFeedItemV1.product,
              name: "کالای عمومی",
            },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("region", { name: "فید دنبال‌شده‌ها" })).toContainText(
    "کالای فروشگاه دنبال‌شده",
  );
  const navigation = page.getByRole("navigation", { name: "فضای خریدار" });
  await navigation.getByRole("link", { name: "کشف" }).click();
  await expect(page.getByRole("region", { name: "فید کشف" })).toContainText(
    "کالای عمومی",
  );
  await page.goBack();
  await expect(page.getByRole("region", { name: "فید دنبال‌شده‌ها" })).toContainText(
    "کالای فروشگاه دنبال‌شده",
  );
});
