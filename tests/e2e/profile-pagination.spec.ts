import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, test } from "../helpers/release-playwright";
import { createSellerWorkspaceFixture } from "../helpers/seller-workspace-fixture";
import {
  sellerInventoryTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("seller profile shows the next page when there are more than 30 products", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "فضای خریدار" });
  const tabs = page.getByRole("navigation", { name: "فید فروشگاه‌ها" });
  await expect(navigation.getByRole("link", { name: "خانه" })).toBeVisible();
  await navigation.getByRole("link", { name: "کشف" }).click();
  await expect(tabs.getByRole("link", { name: "کشف" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "دنبال‌شده‌ها" })).toBeVisible();
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/$/);
  const mobile = sellerInventoryTestMobiles[visualProjectIndex(testInfo.project.name)]!;
  const fixture = await createSellerWorkspaceFixture(page, {
    mobile,
    slug: `profile-pages-${randomUUID().slice(0, 8)}`,
    storeName: "فروشگاه آزمون صفحه‌بندی",
  });
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`update store_stores set status = 'DRAFT', published_at = null, publication_version = 0 where id = ${fixture.storeId}`;
    for (let index = 0; index < 31; index++) {
      const productId = randomUUID();
      const variantId = randomUUID();
      await sql`insert into product_products (id, store_id, state, revision) values (${productId}, ${fixture.storeId}, 'DRAFT', 1)`;
      await sql`insert into product_variants (id, product_id, store_id, client_key, combination_key, retired, ever_published) values (${variantId}, ${productId}, ${fixture.storeId}, 'simple', 'simple', false, false)`;
      await sql`insert into product_working_copies (product_id, name, description, variant_id, definition) values (${productId}, ${`کالای آزمون ${index + 1}`}, '', ${variantId}, ${sql.json({ name: `کالای آزمون ${index + 1}`, orderedMediaIds: [] })})`;
    }
    await page.goto("/");
    await expect(navigation.getByRole("link", { name: "پروفایل" })).toBeVisible();
    await navigation.getByRole("link", { name: "پروفایل" }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByText("در حال راه‌اندازی")).toBeVisible();
    const productLinks = page.locator('a[href^="/seller/products/"][href$="/edit"]');
    await expect(productLinks).toHaveCount(30);
    const firstPage = await productLinks.allTextContents();
    await page.getByRole("link", { name: "دیدن کالاهای بیشتر" }).click();
    await expect(page).toHaveURL(/\/profile\?cursor=/);
    await expect(productLinks).toHaveCount(1);
    expect(firstPage).not.toContain((await productLinks.allTextContents())[0]);
    await expect(page.getByRole("link", { name: "دیدن کالاهای بیشتر" })).toHaveCount(0);
    await page.getByRole("link", { name: "بازگشت به کالاهای نخست" }).click();
    await expect(productLinks).toHaveCount(30);
  } finally {
    await sql`delete from product_products where store_id = ${fixture.storeId}`;
    await sql.end();
    await fixture.cleanup();
  }
});
