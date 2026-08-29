import { expect, test } from "@playwright/test";
import { conversationsV1Examples } from "@sevo/contracts/conversations/v1";

import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
  assertInteractiveTargets,
} from "../helpers/visual-assertions";

test("buyer conversations recover from loading failure and expose the empty list", async ({
  page,
}, testInfo) => {
  let fail = true;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/conversations?*", (route) =>
    route.fulfill({
      status: fail ? 503 : 200,
      json: fail
        ? { code: "INTERNAL_SERVER_ERROR" }
        : conversationsV1Examples.ConversationThreadPageV1,
    }),
  );

  await page.goto("/conversations");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "گفت‌وگوها" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "گفت‌وگوها بارگیری نشدند",
  );
  fail = false;
  await page.getByRole("button", { name: "تلاش دوباره" }).click();
  await expect(page.getByText("هنوز گفت‌وگویی ندارید.")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "فضای خریدار" }).getByRole("link", {
      name: "گفت‌وگوها",
    }),
  ).toHaveAttribute("aria-current", "page");
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page, "main button, main a");
  await assertMinimumContrast(page.locator("main h1, main p, main button"));
  expect(
    await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("buyer-conversations-empty.png"),
    fullPage: true,
  });
});

test("buyer reads a long Persian thread and retries one unsent message without duplication", async ({
  page,
}, testInfo) => {
  const thread = conversationsV1Examples.ConversationThreadV1;
  const longText =
    "این پیام فارسی بلند برای بررسی شکستن درست خط‌ها و خوانایی رشته است. ".repeat(8);
  const existingMessage = {
    ...conversationsV1Examples.ConversationMessageV1,
    content: { type: "TEXT" as const, text: longText },
  };
  const sentBodies: string[] = [];
  const sentKeys: string[] = [];
  let failSend = true;

  await page.route(`**/api/conversations/${thread.conversationId}`, (route) =>
    route.fulfill({ json: thread }),
  );
  await page.route(
    `**/api/conversations/${thread.conversationId}/messages?*`,
    (route) => route.fulfill({ json: { version: 1, items: [existingMessage] } }),
  );
  await page.route(
    `**/api/conversations/${thread.conversationId}/messages`,
    async (route) => {
      sentBodies.push(route.request().postData() ?? "");
      sentKeys.push(route.request().headers()["idempotency-key"] ?? "");
      await route.fulfill({
        status: failSend ? 503 : 201,
        json: failSend
          ? { code: "INTERNAL_SERVER_ERROR" }
          : conversationsV1Examples.ConversationMessageV1,
      });
    },
  );

  await page.goto(`/conversations/${thread.conversationId}`);
  await expect(page.getByText(longText)).toBeVisible();
  const composer = page.getByRole("textbox", { name: "پیام" });
  await composer.focus();
  await composer.fill("سلام، درباره این کالا یک پرسش دارم.");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "فرستادن پیام" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("پیام فرستاده نشد.")).toBeVisible();
  failSend = false;
  await page.getByRole("button", { name: "تلاش دوباره برای ارسال" }).click();
  await expect(page.getByText("پیام فرستاده نشد.")).toHaveCount(0);
  expect(sentBodies).toHaveLength(2);
  expect(sentBodies[1]).toBe(sentBodies[0]);
  expect(sentKeys[0]).toBeTruthy();
  expect(sentKeys[1]).toBe(sentKeys[0]);
  await assertNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("buyer-conversation-thread.png"),
    fullPage: true,
  });
});

test("contextual conversation resumes safely after login and opens its stable URL", async ({
  page,
}) => {
  const thread = conversationsV1Examples.ConversationThreadV1;
  const source = "/s/khane-sofal/products/0d113616-5ad8-45d2-a126-b5b3412b3dd7";
  const newConversation = `/conversations/new?${new URLSearchParams({
    kind: "PRODUCT",
    storeId: thread.context.storeId,
    productId:
      thread.context.kind === "PRODUCT"
        ? thread.context.productId
        : "0d113616-5ad8-45d2-a126-b5b3412b3dd7",
    returnTo: source,
  })}`;
  let unauthenticated = true;

  await page.route("**/api/conversations", (route) =>
    route.fulfill({
      status: unauthenticated ? 401 : 201,
      json: unauthenticated ? { code: "UNAUTHENTICATED" } : thread,
    }),
  );
  await page.route(`**/api/conversations/${thread.conversationId}`, (route) =>
    route.fulfill({ json: thread }),
  );
  await page.route(
    `**/api/conversations/${thread.conversationId}/messages?*`,
    (route) => route.fulfill({ json: { version: 1, items: [] } }),
  );

  await page.goto(newConversation);
  await expect(page).toHaveURL(/\/login\?/);
  const login = new URL(page.url());
  expect(login.searchParams.get("returnTo")).toBe(newConversation);
  expect(login.searchParams.get("cancelTo")).toBe(source);

  unauthenticated = false;
  await page.goto(newConversation);
  await expect(page).toHaveURL(`/conversations/${thread.conversationId}`);
});
