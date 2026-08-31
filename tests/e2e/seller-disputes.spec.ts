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
  await page.emulateMedia({ reducedMotion: "reduce" });
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
  const evidenceId = randomUUID();
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
                 evidenceId,
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
      page.getByRole("heading", {
        name: "یک پرونده اختلاف منتظر پاسخ فروشگاه است",
      }),
    ).toBeVisible();
    await expect(page.getByText("مهلت پاسخ:")).toBeVisible();
    await page.getByRole("link", { name: "پاسخ به پرونده اختلاف" }).click();

    await expect(page).toHaveURL(new RegExp(`/seller/disputes/${disputeId}$`));
    await expect(
      page.getByRole("heading", { name: "کالا آسیب‌دیده است" }),
    ).toBeVisible();
    await expect(page.getByText(orderId)).toHaveCount(0);
    const textarea = page.getByLabel("توضیح شما");
    const evidence = page.getByLabel("انتخاب تصویر مدرک");
    const submit = page.getByRole("button", { name: "ثبت پاسخ فروشگاه" });
    await textarea.fill(
      "کالا را با دقت بررسی می‌کنیم و امروز نتیجه و راه‌حل روشن را اعلام می‌کنیم. ".repeat(
        8,
      ),
    );
    await evidence.setInputFiles({
      name: "seller-proof.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await textarea.focus();
    await page.keyboard.press("Tab");
    await expect(evidence).toBeFocused();
    expect(
      await evidence.evaluate((element) => element.matches(":focus-visible")),
    ).toBe(true);
    await page.keyboard.press("Tab");
    await expect(submit).toBeFocused();
    expect(await submit.evaluate((element) => element.matches(":focus-visible"))).toBe(
      true,
    );
    expect(
      await submit.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).transitionDuration),
      ),
    ).toBeLessThanOrEqual(0.001);
    await page.keyboard.press("Enter");

    await expect(
      page.getByText("پاسخ فروشگاه ثبت شد و پرونده برای بررسی سوو فرستاده شد."),
    ).toBeVisible();
    await expect(page.getByText("در حال بررسی سوو")).toBeVisible();
    await expect(page.getByRole("button", { name: "ثبت پاسخ فروشگاه" })).toHaveCount(0);

    await assertNoHorizontalOverflow(page);
    await assertInteractiveTargets(page, "main a, main button, main textarea");
    await assertMinimumContrast(page.locator("h1, h2, p, a, button, label, span"));

    const retryDisputeId = randomUUID();
    const retryOpenedAt = new Date();
    await sql`
      insert into problem_disputes
        (id, order_id, buyer_identity_id, store_id, status, category,
         opened_at, deadline_kind, deadline_at, contributions, outcome,
         version, updated_at)
      values
        (${retryDisputeId}, ${randomUUID()}, ${buyerId}, ${fixture.storeId},
         'AWAITING_SELLER_RESPONSE', 'WRONG_ITEM', ${retryOpenedAt},
         'SELLER_FIRST_RESPONSE', ${new Date(retryOpenedAt.getTime() + 86_400_000)},
         ${sql.json([
           {
             authorKind: "BUYER",
             text: "کالای دیگری به جای سفارش من تحویل شده است.",
             evidence: [],
             submittedAt: retryOpenedAt.toISOString(),
           },
         ])}, null, 1, ${retryOpenedAt})
    `;
    const retryKeys: string[] = [];
    let returnInProgress = true;
    await page.route(
      `**/api/seller/disputes/${retryDisputeId}/response`,
      async (route) => {
        retryKeys.push(route.request().headers()["idempotency-key"] ?? "");
        if (returnInProgress) {
          returnInProgress = false;
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              code: "IDEMPOTENCY_IN_PROGRESS",
              message: "درخواست در حال پردازش است.",
              correlationId: randomUUID(),
            }),
          });
          return;
        }
        await route.fallback();
      },
    );
    await page.goto(`/seller/disputes/${retryDisputeId}`);
    await page
      .getByLabel("توضیح شما")
      .fill("همان درخواست را بدون ساخت پاسخ تکراری دوباره بررسی می‌کنیم.");
    await page.getByRole("button", { name: "ثبت پاسخ فروشگاه" }).click();
    await expect(page.getByText(/همین پاسخ هنوز در حال ثبت است/)).toBeVisible();
    await page.getByRole("button", { name: "ثبت پاسخ فروشگاه" }).click();
    await expect(
      page.getByText("پاسخ فروشگاه ثبت شد و پرونده برای بررسی سوو فرستاده شد."),
    ).toBeVisible();
    expect(retryKeys).toHaveLength(2);
    expect(retryKeys[1]).toBe(retryKeys[0]);

    const expiredDisputeId = randomUUID();
    const expiredOpenedAt = new Date();
    await sql`
      insert into problem_disputes
        (id, order_id, buyer_identity_id, store_id, status, category,
         opened_at, deadline_kind, deadline_at, contributions, outcome,
         version, updated_at)
      values
        (${expiredDisputeId}, ${randomUUID()}, ${buyerId}, ${fixture.storeId},
         'AWAITING_SELLER_RESPONSE', 'REFUND_NOT_COMPLETED', ${expiredOpenedAt},
         'SELLER_FIRST_RESPONSE', ${new Date(expiredOpenedAt.getTime() - 86_400_000)},
         ${sql.json([
           {
             authorKind: "BUYER",
             text: "بازپرداخت اعلام‌شده هنوز به حساب من نرسیده است.",
             evidence: [],
             submittedAt: expiredOpenedAt.toISOString(),
           },
         ])}, null, 1, ${expiredOpenedAt})
    `;
    await page.goto(`/seller/disputes/${expiredDisputeId}`);
    await expect(page.getByText(/پرونده اکنون در نوبت بررسی سوو است/)).toBeVisible();
    await expect(page.getByRole("button", { name: "ثبت پاسخ فروشگاه" })).toHaveCount(0);

    const foreignDisputeId = randomUUID();
    const foreignOpenedAt = new Date();
    await sql`
      insert into problem_disputes
        (id, order_id, buyer_identity_id, store_id, status, category,
         opened_at, deadline_kind, deadline_at, contributions, outcome,
         version, updated_at)
      values
        (${foreignDisputeId}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()},
         'AWAITING_SELLER_RESPONSE', 'WRONG_ITEM', ${foreignOpenedAt},
         'SELLER_FIRST_RESPONSE', ${new Date(foreignOpenedAt.getTime() + 86_400_000)},
         ${sql.json([
           {
             authorKind: "BUYER",
             text: "کالای دیگری به جای سفارش من تحویل شده است.",
             evidence: [],
             submittedAt: foreignOpenedAt.toISOString(),
           },
         ])}, null, 1, ${foreignOpenedAt})
    `;
    await page.goto(`/seller/disputes/${foreignDisputeId}`);
    await expect(
      page.getByRole("heading", { name: "این پرونده در دسترس نیست" }),
    ).toBeVisible();
  } finally {
    await sql.end();
    await fixture.cleanup();
  }
});
