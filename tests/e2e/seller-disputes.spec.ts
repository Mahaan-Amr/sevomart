import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  sellerDisputeTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";
import { createSellerWorkspaceFixture } from "../helpers/seller-workspace-fixture";

test("seller sees the nearest deadline and submits one store-scoped response", async ({
  page,
}, testInfo) => {
  const index = visualProjectIndex(testInfo.project.name);
  const fixture = await createSellerWorkspaceFixture(page, {
    mobile: sellerDisputeTestMobiles[index]!,
    slug: `seller-dispute-${index}`,
    storeName: "فروشگاه پاسخ‌گو",
  });
  const sql = postgres(
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo",
    { max: 1 },
  );
  const disputeId = randomUUID();
  const orderId = randomUUID();
  const buyerId = randomUUID();
  const openedAt = new Date();
  const deadline = new Date(openedAt.getTime() + 24 * 60 * 60 * 1_000);

  try {
    await sql`
      insert into problem_disputes
        (id, order_id, buyer_identity_id, store_id, status, category,
         opened_at, deadline_kind, deadline_at, contributions, outcome,
         version, updated_at)
      values
        (${disputeId}, ${orderId}, ${buyerId}, ${fixture.storeId},
         'AWAITING_SELLER_RESPONSE', 'DAMAGED', ${openedAt},
         'SELLER_FIRST_RESPONSE', ${deadline}, ${sql.json([
           {
             authorKind: "BUYER",
             text: "بسته سالم بود اما کالا هنگام تحویل شکستگی داشت.",
             evidence: [
               {
                 evidenceId: randomUUID(),
                 kind: "IMAGE",
                 submittedAt: openedAt.toISOString(),
               },
             ],
             submittedAt: openedAt.toISOString(),
           },
         ])}, null, 1, ${openedAt})
    `;

    await page.goto("/seller");
    await expect(
      page.getByRole("heading", { name: "یک اختلاف منتظر پاسخ فروشگاه است" }),
    ).toBeVisible();
    await expect(page.getByText("مهلت پاسخ:")).toBeVisible();
    await page.getByRole("link", { name: "پاسخ به اختلاف" }).click();

    await expect(page).toHaveURL(new RegExp(`/seller/disputes/${disputeId}$`));
    await expect(
      page.getByRole("heading", { name: "کالا آسیب‌دیده است" }),
    ).toBeVisible();
    await expect(page.getByText("فروشگاه پاسخ‌گو")).toHaveCount(0);
    await expect(page.getByText("تصویر")).toBeVisible();
    await page
      .getByLabel("توضیح شما")
      .fill("کالا را بررسی می‌کنیم و امروز نتیجه و راه‌حل را اعلام می‌کنیم.");
    await page.getByRole("button", { name: "ثبت پاسخ فروشگاه" }).click();

    await expect(
      page.getByText("پاسخ فروشگاه ثبت شد و پرونده برای بررسی سوو فرستاده شد."),
    ).toBeVisible();
    await expect(page.getByText("در حال بررسی سوو")).toBeVisible();
    await expect(page.getByRole("button", { name: "ثبت پاسخ فروشگاه" })).toHaveCount(0);

    await assertNoHorizontalOverflow(page);
    await assertInteractiveTargets(
      page,
      "main a, main button, main input, main select, main textarea",
    );
    await assertMinimumContrast(page.locator("h1, h2, p, a, button, label, span"));

    await page.goto(`/seller/disputes/${randomUUID()}`);
    await expect(
      page.getByRole("heading", { name: "این پرونده در دسترس نیست" }),
    ).toBeVisible();
  } finally {
    await sql.end();
    await fixture.cleanup();
  }
});
