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
  await expect(posts.first().locator("img")).toBeVisible();
  await expect(posts.last()).toContainText("ناموجود");
  const first = await posts.nth(0).boundingBox();
  const second = await posts.nth(1).boundingBox();
  expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
  const imageLink = posts.first().getByRole("link", { name: /دیدن.*گزینه/ });
  await expect(imageLink).toHaveAttribute("href", new RegExp(item.productId));
  await imageLink.focus();
  await expect(imageLink).toBeFocused();
  expect(
    await imageLink.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  await imageLink.click();
  await page.goBack();
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(imageLink).toBeFocused();
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
