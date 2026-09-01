import { expect, test } from "@playwright/test";
import { discoveryV1Examples } from "@sevo/contracts/discovery/v1";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";

function feedItem(position: number, store = "خانه سفال") {
  return {
    ...discoveryV1Examples.DiscoveryFeedItemV1,
    productId: `${String(position).padStart(8, "0")}-5ad8-45d2-a126-b5b3412b3dd7`,
    product: {
      ...discoveryV1Examples.DiscoveryFeedItemV1.product,
      name: `کالای تازه ${position}`,
    },
    store: { ...discoveryV1Examples.DiscoveryFeedItemV1.store, name: store },
  };
}

test("discovery and following keep independent cursor and scroll state", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const firstItems = Array.from({ length: 18 }, (_, index) => feedItem(index + 1));
  await page.route("**/api/store/media/*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#F6E3E9"/></svg>',
    }),
  );
  await page.route("**/api/discovery*", (route) =>
    route.fulfill({
      json: route.request().url().includes("cursor=discovery-next")
        ? {
            ...discoveryV1Examples.DiscoveryFeedPageV1,
            emptyState: undefined,
            items: [feedItem(19)],
          }
        : {
            ...discoveryV1Examples.DiscoveryFeedPageV1,
            emptyState: undefined,
            items: firstItems,
            nextCursor: "discovery-next",
          },
    }),
  );
  await page.route("**/api/following*", (route) =>
    route.fulfill({
      json: {
        ...discoveryV1Examples.FollowingFeedPageV1,
        emptyState: undefined,
        visibleFollowedStoreCount: 1,
        followSetRevision: 1,
        items: [feedItem(20, "فروشگاه دنبال‌شده با نام بلند برای بررسی چیدمان فارسی")],
      },
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "دیدن کالاهای بیشتر" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(19);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const discoveryScroll = await page.evaluate(() => window.scrollY);

  await page.getByRole("link", { name: "دنبال‌شده‌ها" }).click();
  await expect(page.getByRole("heading", { name: "دنبال‌شده‌ها" })).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "فروشگاه دنبال‌شده با نام بلند برای بررسی چیدمان فارسی",
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page, "main a, main button, nav a");
  await assertMinimumContrast(page.locator("main h2, main strong, main a, main span"));
  expect(
    await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("following-mobile.png"),
    fullPage: true,
  });

  await page.getByRole("link", { name: "کشف", exact: true }).click();
  await expect(page.getByRole("listitem")).toHaveCount(19);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(discoveryScroll);
});

test("following asks a guest to sign in and cancellation restores discovery", async ({
  page,
}) => {
  await page.route("**/api/discovery*", (route) =>
    route.fulfill({
      json: {
        ...discoveryV1Examples.DiscoveryFeedPageV1,
        emptyState: undefined,
        items: [feedItem(1)],
      },
    }),
  );
  await page.route("**/api/following*", (route) =>
    route.fulfill({ status: 401, json: { code: "UNAUTHENTICATED" } }),
  );

  await page.goto("/");
  await expect(page.getByText("کالای تازه 1")).toBeVisible();
  await page.getByRole("link", { name: "دنبال‌شده‌ها" }).click();
  await expect(page).toHaveURL(/\/login\?/);
  const loginUrl = new URL(page.url());
  expect(loginUrl.searchParams.get("returnTo")).toBe("/following");
  expect(loginUrl.searchParams.get("cancelTo")).toBe("/");

  await page.getByRole("link", { name: "انصراف و بازگشت", exact: true }).click();
  await expect(page.getByText("کالای تازه 1")).toBeVisible();
});

test("a stale following cursor replaces the old snapshot instead of merging it", async ({
  page,
}) => {
  let initialReads = 0;
  await page.route("**/api/following*", (route) => {
    if (route.request().url().includes("cursor=stale-following")) {
      return route.fulfill({
        status: 409,
        json: { code: "FEED_CURSOR_STALE", message: "فید تغییر کرده است." },
      });
    }
    initialReads += 1;
    return route.fulfill({
      json: {
        ...discoveryV1Examples.FollowingFeedPageV1,
        emptyState: undefined,
        visibleFollowedStoreCount: 1,
        followSetRevision: initialReads,
        items: [feedItem(initialReads)],
        ...(initialReads === 1 ? { nextCursor: "stale-following" } : {}),
      },
    });
  });

  await page.goto("/following");
  await expect(page.getByText("کالای تازه 1")).toBeVisible();
  await page.getByRole("button", { name: "دیدن کالاهای بیشتر" }).click();

  await expect(page.getByText("کالای تازه 2")).toBeVisible();
  await expect(page.getByText("کالای تازه 1")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("فید را تازه کردیم");
});
