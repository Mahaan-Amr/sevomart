import { expect, test, type Locator, type Page } from "@playwright/test";
import { discoveryFeedProjectionEventTypes } from "@sevo/contracts/discovery/v1";
import postgres from "postgres";

import { acceptanceTestMobiles, visualProjectIndex } from "../helpers/visual-projects";
import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";

test.describe.configure({ mode: "serial" });

let slug: string;
let storeId: string;
let secondaryStoreId: string;
let mobile: string;
let feedProducts: Array<{
  productId: string;
  variantId: string;
  mediaId: string;
}>;

test.beforeAll(async ({ browserName }, testInfo) => {
  expect(browserName).toBe("chromium");
  const index = visualProjectIndex(testInfo.project.name);
  slug = `follow-e2e-${index}`;
  const secondarySlug = `${slug}-secondary`;
  storeId = crypto.randomUUID();
  secondaryStoreId = crypto.randomUUID();
  feedProducts = [0, 1].map(() => ({
    productId: crypto.randomUUID(),
    variantId: crypto.randomUUID(),
    mediaId: crypto.randomUUID(),
  }));
  mobile = acceptanceTestMobiles[index]!;
  const sql = postgres(databaseUrl, { max: 1 });
  await sql`delete from discovery_follow_idempotency_records where store_id in (
    select id from store_stores where slug in ${sql([slug, secondarySlug])}
  )`;
  await sql`delete from discovery_store_follows where store_id in (
    select id from store_stores where slug in ${sql([slug, secondarySlug])}
  )`;
  await sql`delete from discovery_public_follower_counts where store_id in (
    select id from store_stores where slug in ${sql([slug, secondarySlug])}
  )`;
  await sql`delete from discovery_product_feed_version_buffers where product_id in (
    select id from product_products where store_id in (
      select id from store_stores where slug in ${sql([slug, secondarySlug])}
    )
  )`;
  await sql`delete from discovery_product_feed_projections where store_id in (
    select id from store_stores where slug in ${sql([slug, secondarySlug])}
  )`;
  await sql`delete from discovery_store_feed_projections where store_id in (
    select id from store_stores where slug in ${sql([slug, secondarySlug])}
  )`;
  await sql`delete from inventory_levels where store_id in (
    select id from store_stores where slug in ${sql([slug, secondarySlug])}
  )`;
  await sql`delete from product_products where store_id in (
    select id from store_stores where slug in ${sql([slug, secondarySlug])}
  )`;
  await sql`delete from store_stores where slug in ${sql([slug, secondarySlug])}`;
  await sql`
    insert into store_stores
      (id, name, slug, bio, return_policy, return_policy_revision,
       settlement_kind, settlement_status, settlement_verified_at,
       theme_color, status, published_at, publication_version, revision, updated_at)
    values
      (${storeId}, 'خانه دنبال‌کردنی', ${slug}, 'کالاهای ساده و دست‌ساز',
       'تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.', 1,
       'TEST', 'TEST_VERIFIED', now(), '#A41439', 'PUBLISHED', now(), 1, 1, now())
  `;
  await sql`
    insert into store_memberships (id, store_id, seller_id, role)
    values (${crypto.randomUUID()}, ${storeId}, ${crypto.randomUUID()}, 'OWNER')
  `;
  await sql`
    insert into store_stores
      (id, name, slug, bio, return_policy, return_policy_revision,
       settlement_kind, settlement_status, settlement_verified_at,
       theme_color, status, published_at, publication_version, revision, updated_at)
    values
      (${secondaryStoreId}, 'خانه دوم', ${secondarySlug}, 'کالاهای دست‌ساز',
       'تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.', 1,
       'TEST', 'TEST_VERIFIED', now(), '#A41439', 'PUBLISHED', now(), 1, 1, now())
  `;
  await sql`
    insert into store_memberships (id, store_id, seller_id, role)
    values (${crypto.randomUUID()}, ${secondaryStoreId}, ${crypto.randomUUID()}, 'OWNER')
  `;
  await sql`
    insert into store_shipping_methods
      (id, store_id, position, revision, code, label, fixed_fee_amount,
       currency, estimated_delivery_text, enabled,
       requires_delivery_address, requires_postal_code)
    values
      (${crypto.randomUUID()}, ${storeId}, 0, 1, 'NATIONAL_POST', 'پست پیشتاز', 0,
       'IRR', 'دو تا چهار روز کاری', true, true, true)
  `;
  await sql`
    insert into store_shipping_methods
      (id, store_id, position, revision, code, label, fixed_fee_amount,
       currency, estimated_delivery_text, enabled,
       requires_delivery_address, requires_postal_code)
    values
      (${crypto.randomUUID()}, ${secondaryStoreId}, 0, 1, 'NATIONAL_POST',
       'پست پیشتاز', 0, 'IRR', 'دو تا چهار روز کاری', true, true, true)
  `;
  await sql`
    insert into discovery_store_feed_projections
      (store_id, published, aggregate_version, publication_version, updated_at)
    values (${storeId}, true, 1, 1, now())
    on conflict (store_id) do update set published = true,
      aggregate_version = 1, publication_version = 1, updated_at = now()
  `;
  for (const [position, product] of feedProducts.entries()) {
    const publishedAt = `2026-08-${23 + position}T10:00:00.000Z`;
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at,
         created_at, updated_at)
      values (${product.productId}, ${storeId}, 'PUBLISHED', 1, 1,
        ${publishedAt}, ${publishedAt}, ${publishedAt})
    `;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id, variant_id)
      values (${product.productId}, 1, ${`فنجان دنبال‌شده ${position + 1}`},
        'فنجان دست‌ساز', ${product.mediaId}, ${product.variantId})
    `;
    await sql`
      insert into product_offers (product_id, variant_id, amount, currency, revision)
      values (${product.productId}, ${product.variantId}, ${1_000_000 + position * 10},
        'IRR', 1)
    `;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${product.variantId}, ${storeId}, 5, 1)
    `;
    await sql`
      insert into discovery_product_feed_projections
        (product_id, store_id, product_aggregate_version, publication_version,
         published, first_published_at, eligible_since, offer_version,
         availability_version, publication_updated_at, updated_at)
      values (${product.productId}, ${storeId}, 1, 1, true, ${publishedAt},
        ${publishedAt}, 1, 1, ${publishedAt}, now())
    `;
  }
  await sql`
    update discovery_projection_status
    set healthy = true, reason = null, updated_at = now()
    where projection_name = 'public-feed-v1'
  `;
  await sql.end();
});

test("guest cancel preserves the store and login completes a retriable follow", async ({
  page,
}) => {
  await page.goto(`/s/${slug}?source=discovery#store-actions`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page);
  await assertMinimumContrast(page.locator("button, a"));
  await expect(page.getByText("۰ دنبال‌کننده")).toBeVisible();
  const guestFollow = page.getByRole("button", { name: "دنبال‌کردن فروشگاه" });
  await focusByTab(page, guestFollow);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login\?/);
  await expect
    .poll(() =>
      page.evaluate(
        (path) => sessionStorage.getItem(`sevo:store-return:${path}`),
        `/s/${slug}`,
      ),
    )
    .not.toBeNull();

  const cancel = page.getByRole("link", { name: "انصراف و بازگشت به فروشگاه" });
  await focusByTab(page, cancel);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/s/${slug}?source=discovery#store-actions`);
  await expect(page.getByRole("button", { name: "دنبال‌کردن فروشگاه" })).toBeVisible();

  await page.getByRole("button", { name: "دنبال‌کردن فروشگاه" }).click();
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");

  let failOnce = true;
  await page.route("**/api/store/me/follows/*", async (route) => {
    if (failOnce && route.request().method() === "PUT") {
      failOnce = false;
      const processed = await route.fetch();
      expect(processed.status()).toBe(200);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL_SERVER_ERROR",
          message: "ارتباط با سرور برقرار نشد.",
          correlationId: crypto.randomUUID(),
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "ورود" }).click();

  await expect
    .poll(() => {
      const url = new URL(page.url());
      return {
        pathname: url.pathname,
        source: url.searchParams.get("source"),
        follow: url.searchParams.get("follow"),
        hash: url.hash,
      };
    })
    .toEqual({
      pathname: `/s/${slug}`,
      source: "discovery",
      follow: "1",
      hash: "#store-actions",
    });
  await expect(page.getByText("ارتباط با سرور برقرار نشد.")).toBeVisible();
  const retry = page.getByRole("button", { name: "تلاش دوباره" });
  await assertMinimumContrast(retry);
  await focusByTab(page, retry);
  await page.keyboard.press("Enter");
  const activeFollow = page.getByRole("button", {
    name: "لغو دنبال‌کردن فروشگاه",
  });
  await expect(activeFollow).toBeVisible();
  await expect(activeFollow).toBeEnabled();
  await expect
    .poll(() =>
      activeFollow.evaluate((button) => getComputedStyle(button).backgroundColor),
    )
    .toBe("rgb(244, 240, 241)");
  await assertMinimumContrast(activeFollow);
  await expect(page.getByText("۱ دنبال‌کننده")).toBeVisible();

  await page.route("**/api/store/me/follows/*", async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "REVISION_CONFLICT",
          message: "وضعیت فروشگاه تازه‌تر شده است.",
          correlationId: crypto.randomUUID(),
          details: { currentRevision: 2 },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "لغو دنبال‌کردن فروشگاه" }).click();
  await expect(page.getByText("وضعیت فروشگاه تازه‌تر شده است.")).toBeVisible();
  const refreshState = page.getByRole("button", { name: "تازه‌کردن وضعیت" });
  await expect(refreshState).toBeVisible();
  await assertMinimumContrast(refreshState);

  await page.reload();
  await expect(page.getByText("۱ دنبال‌کننده")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "لغو دنبال‌کردن فروشگاه" }),
  ).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const transitionDuration = await page
    .getByRole("button", { name: "لغو دنبال‌کردن فروشگاه" })
    .evaluate((button) => getComputedStyle(button).transitionDuration);
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001);

  const sql = postgres(databaseUrl, { max: 1 });
  await sql`
    insert into platform_outbox_consumptions (consumer_name, event_id, consumed_at)
    select 'discovery-public-feed-v1', event_id, now()
    from platform_outbox_events
    where event_type in ${sql(discoveryFeedProjectionEventTypes)}
    on conflict (consumer_name, event_id) do nothing
  `;
  await sql.end();
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3109";
  const firstFeed = await page.request.get(
    `${apiBaseUrl}/v1/me/feeds/following?limit=1`,
  );
  expect(firstFeed.status()).toBe(200);
  const firstFeedBody = await firstFeed.json();
  expect(firstFeedBody).toMatchObject({
    visibleFollowedStoreCount: 1,
    followSetRevision: expect.any(Number),
    items: [{ productId: feedProducts[1]!.productId }],
  });
  expect(firstFeedBody.nextCursor).toEqual(expect.any(String));

  const directUnfollow = await page.request.delete(
    `${apiBaseUrl}/v1/me/follows/${storeId}`,
    {
      headers: {
        "Idempotency-Key": `e2e-feed-unfollow-${storeId}`,
        "If-Match": '"1"',
      },
    },
  );
  expect(directUnfollow.status()).toBe(200);
  const staleFeed = await page.request.get(
    `${apiBaseUrl}/v1/me/feeds/following?limit=1&cursor=${encodeURIComponent(
      firstFeedBody.nextCursor,
    )}`,
  );
  expect(staleFeed.status()).toBe(409);
  expect(await staleFeed.json()).toMatchObject({ code: "FEED_CURSOR_STALE" });

  const directRefollow = await page.request.put(
    `${apiBaseUrl}/v1/me/follows/${storeId}`,
    {
      headers: {
        "Idempotency-Key": `e2e-feed-refollow-${storeId}`,
        "If-Match": '"2"',
      },
    },
  );
  expect(directRefollow.status()).toBe(200);
  const beforeAnotherFollow = await page.request.get(
    `${apiBaseUrl}/v1/me/feeds/following?limit=1`,
  );
  expect(beforeAnotherFollow.status()).toBe(200);
  const beforeAnotherFollowBody = await beforeAnotherFollow.json();
  expect(beforeAnotherFollowBody.nextCursor).toEqual(expect.any(String));

  const anotherFollow = await page.request.put(
    `${apiBaseUrl}/v1/me/follows/${secondaryStoreId}`,
    {
      headers: { "Idempotency-Key": `e2e-feed-follow-${secondaryStoreId}` },
    },
  );
  expect(anotherFollow.status()).toBe(200);
  const staleAfterFollow = await page.request.get(
    `${apiBaseUrl}/v1/me/feeds/following?limit=1&cursor=${encodeURIComponent(
      beforeAnotherFollowBody.nextCursor,
    )}`,
  );
  expect(staleAfterFollow.status()).toBe(409);
  expect(await staleAfterFollow.json()).toMatchObject({
    code: "FEED_CURSOR_STALE",
  });
});

async function focusByTab(page: Page, target: Locator) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) {
      await expect(target).toBeFocused();
      const hasVisibleIndicator = await target.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== "none" || style.boxShadow !== "none";
      });
      expect(hasVisibleIndicator).toBe(true);
      return;
    }
  }
  throw new Error("Keyboard tab order did not reach the expected control");
}
