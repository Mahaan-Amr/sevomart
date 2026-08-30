import {
  expect,
  request as apiRequest,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import postgres from "postgres";

import {
  buyerConversationTestMobiles,
  otherSellerConversationTestMobiles,
  sellerConversationTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";
import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
const apiBaseUrl = `http://127.0.0.1:${process.env.SEVO_E2E_API_PORT ?? "3109"}`;

test("seller answers one private thread without duplicate effects and gets a safe way back", async ({
  page,
}, testInfo) => {
  const index = visualProjectIndex(testInfo.project.name);
  const sellerMobile = sellerConversationTestMobiles[index]!;
  const buyerMobile = buyerConversationTestMobiles[index]!;
  const otherSellerMobile = otherSellerConversationTestMobiles[index]!;
  const sql = postgres(databaseUrl, { max: 1 });
  const buyerApi = await apiRequest.newContext({ baseURL: apiBaseUrl });
  const otherSellerApi = await apiRequest.newContext({
    baseURL: apiBaseUrl,
  });
  const storeId = crypto.randomUUID();
  const otherStoreId = crypto.randomUUID();
  let sellerIdentityId: string | undefined;
  let otherSellerIdentityId: string | undefined;

  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/seller/login");
    await page.getByLabel("شماره موبایل").fill(sellerMobile);
    await page.getByRole("button", { name: "دریافت کد" }).click();
    await page.getByLabel("کد شش‌رقمی").fill("111111");
    await page.getByRole("button", { name: "ورود" }).click();

    const sellerRows = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId"
      from identity_login_methods
      where mobile = ${sellerMobile}
    `;
    sellerIdentityId = sellerRows[0]?.identityId;
    if (!sellerIdentityId) throw new Error("seller conversation identity missing");

    const buyer = await signInApi(buyerApi, buyerMobile);
    const otherSeller = await signInApi(otherSellerApi, otherSellerMobile);
    otherSellerIdentityId = otherSeller.identityId;

    await sql.begin(async (transaction) => {
      await transaction`
        delete from store_memberships
        where seller_id in (${sellerIdentityId}, ${otherSeller.identityId})
      `;
      await transaction`
        delete from identity_seller_access
        where identity_id in (${sellerIdentityId}, ${otherSeller.identityId})
      `;
      await transaction`
        insert into identity_seller_access (id, identity_id, status)
        values
          (${crypto.randomUUID()}, ${sellerIdentityId}, 'ACTIVE'),
          (${crypto.randomUUID()}, ${otherSeller.identityId}, 'ACTIVE')
      `;
      await transaction`
        insert into store_stores
          (id, name, slug, bio, return_policy, return_policy_revision,
           settlement_kind, settlement_status, settlement_verified_at,
           theme_color, status, revision, publication_version, published_at)
        values
          (${storeId}, 'فروشگاه گفت‌وگوی فروشنده', ${`c-${storeId}`},
           'فروشگاه آزمون گفت‌وگوی فروشنده',
           'تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.', 1,
           'TEST', 'TEST_VERIFIED', now(), '#A41439', 'PUBLISHED', 1, 1, now()),
          (${otherStoreId}, 'فروشگاه نامرتبط', ${`c-${otherStoreId}`},
           'فروشگاه آزمون نامرتبط',
           'تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.', 1,
           'TEST', 'TEST_VERIFIED', now(), '#A41439', 'PUBLISHED', 1, 1, now())
      `;
      await transaction`
        insert into store_shipping_methods
          (id, store_id, position, revision, code, label, fixed_fee_amount,
           currency, estimated_delivery_text, enabled,
           requires_delivery_address, requires_postal_code)
        values
          (${crypto.randomUUID()}, ${storeId}, 0, 1, 'NATIONAL_POST',
           'پست پیشتاز', 0, 'IRR', 'دو تا چهار روز کاری', true, true, true),
          (${crypto.randomUUID()}, ${otherStoreId}, 0, 1, 'NATIONAL_POST',
           'پست پیشتاز', 0, 'IRR', 'دو تا چهار روز کاری', true, true, true)
      `;
      await transaction`
        insert into store_memberships (id, store_id, seller_id, role)
        values
          (${crypto.randomUUID()}, ${storeId}, ${sellerIdentityId}, 'OWNER'),
          (${crypto.randomUUID()}, ${otherStoreId}, ${otherSeller.identityId}, 'OWNER')
      `;
    });

    const conversation = await openConversation(buyerApi, buyer.cookie, storeId);
    const foreignConversation = await openConversation(
      buyerApi,
      buyer.cookie,
      otherStoreId,
    );
    const longBuyerMessage =
      "سلام، برای پیگیری این سفارش و زمان آماده‌سازی راهنمایی می‌خواهم. ".repeat(16);
    const buyerMessage = await buyerApi.post(
      `/v1/conversations/${conversation.conversationId}/messages`,
      {
        headers: {
          cookie: buyer.cookie,
          "idempotency-key": crypto.randomUUID(),
        },
        data: { content: { type: "TEXT", text: longBuyerMessage } },
      },
    );
    expect(buyerMessage.status()).toBe(201);

    await page.goto("/seller");
    const nearestConversation = page.getByRole("link", {
      name: "پاسخ به گفت‌وگو",
    });
    await expect(nearestConversation).toBeVisible();
    await nearestConversation.click();
    await expect(page).toHaveURL(
      `/seller/conversations/${conversation.conversationId}`,
    );
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText(longBuyerMessage)).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await assertMinimumContrast(page.getByRole("button"));

    const idempotencyKeys: string[] = [];
    let loseNextResponse = true;
    await page.route("**/api/conversations/*/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      idempotencyKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (loseNextResponse) {
        loseNextResponse = false;
        const processed = await route.fetch();
        expect(processed.status()).toBe(201);
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

    const sellerReply = "پاسخ فروشنده برای آزمون";
    await page.getByLabel("پاسخ شما").fill(sellerReply);
    await page.getByRole("button", { name: "فرستادن پاسخ" }).click();
    const retry = page.getByRole("button", { name: "تلاش دوباره" });
    await expect(retry).toBeVisible();
    await focusByTab(page, retry);
    await page.keyboard.press("Enter");
    await expect(page.getByText(sellerReply, { exact: true })).toHaveCount(1);
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);

    await page.locator('input[type="file"]').setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("not an image"),
    });
    await page.getByRole("button", { name: "فرستادن پاسخ" }).click();
    await expect(page.getByText(/پیام یا تصویر پذیرفته نشد/)).toBeVisible();
    await expect(page.getByText(sellerReply, { exact: true })).toHaveCount(1);
    await expect(page.getByText("در حال فرستادن…")).toHaveCount(0);

    loseNextResponse = true;
    await page.locator('input[type="file"]').setInputFiles({
      name: "valid.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.getByLabel("توضیح کوتاه تصویر (اختیاری)").fill("تصویر معتبر");
    await page.getByRole("button", { name: "فرستادن پاسخ" }).click();
    const mediaRetry = page.getByRole("button", { name: "تلاش دوباره" });
    await expect(mediaRetry).toBeVisible();
    await mediaRetry.click();
    await expect(page.getByRole("img", { name: "تصویر معتبر" })).toHaveCount(1);
    expect(idempotencyKeys).toHaveLength(4);
    expect(idempotencyKeys[3]).toBe(idempotencyKeys[2]);

    await page.goto(`/seller/conversations/${foreignConversation.conversationId}`);
    await expect(
      page.getByRole("heading", { name: "این گفت‌وگو در دسترس نیست" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "بازگشت به فهرست گفت‌وگوها" }),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.getByRole("link", { name: "بازگشت به فهرست گفت‌وگوها" }).click();
    await expect(page.getByRole("heading", { name: "گفت‌وگوها" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /فروشگاه.*بازکردن رشته/ }),
    ).toBeVisible();

    await sql`
      delete from conversation_threads
      where id = ${conversation.conversationId}
    `;
    await page.goto(`/seller/conversations/${conversation.conversationId}`);
    await expect(
      page.getByRole("heading", { name: "این گفت‌وگو در دسترس نیست" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "بازگشت به فهرست گفت‌وگوها" }),
    ).toBeVisible();
  } finally {
    await sql`delete from conversation_threads where store_id in (${storeId}, ${otherStoreId})`;
    await sql`delete from store_memberships where store_id in (${storeId}, ${otherStoreId})`;
    await sql`delete from store_stores where id in (${storeId}, ${otherStoreId})`;
    if (sellerIdentityId && otherSellerIdentityId) {
      await sql`
        delete from identity_seller_access
        where identity_id in (${sellerIdentityId}, ${otherSellerIdentityId})
      `;
    }
    await Promise.all([buyerApi.dispose(), otherSellerApi.dispose(), sql.end()]);
  }
});

async function signInApi(
  client: Awaited<ReturnType<typeof apiRequest.newContext>>,
  mobile: string,
) {
  const requested = await client.post("/v1/auth/otp/requests", {
    data: { mobile },
  });
  expect(requested.status()).toBe(202);
  const { challengeId } = (await requested.json()) as { challengeId: string };
  const verified = await client.post("/v1/auth/otp/verifications", {
    data: { challengeId, code: "111111" },
  });
  expect(verified.status()).toBe(200);
  const cookie = verified.headers()["set-cookie"];
  if (!cookie) throw new Error("identity session cookie missing");
  const session = await client.get("/v1/auth/session", { headers: { cookie } });
  const body = (await session.json()) as { actor: { identityId: string } };
  return { cookie, identityId: body.actor.identityId };
}

async function openConversation(
  client: Awaited<ReturnType<typeof apiRequest.newContext>>,
  cookie: string,
  storeId: string,
) {
  const opened = await client.post("/v1/conversations", {
    headers: { cookie, "idempotency-key": crypto.randomUUID() },
    data: { context: { kind: "STORE", storeId } },
  });
  expect(opened.status()).toBe(200);
  return (await opened.json()) as { conversationId: string };
}

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
