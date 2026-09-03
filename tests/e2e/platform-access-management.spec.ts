import { expect, test } from "../helpers/release-playwright";
import { captureReleaseCheckpoint } from "../helpers/release-checkpoint";

import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  establishPlatformAgentRecipient,
  establishPlatformAgentSession,
} from "../helpers/platform-agent-session";

test("an access manager grants and immediately revokes a responsibility", async ({
  context,
  page,
}, testInfo) => {
  await establishPlatformAgentSession(context, ["ACCESS_ADMINISTRATION"]);
  const recipientId = await establishPlatformAgentRecipient();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/platform/access");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "مدیریت دسترسی پلتفرم" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "سابقه" })).toHaveCount(0);

  await page.getByText("واگذاری مسئولیت", { exact: true }).first().click();
  await page.getByLabel(/شناسه هویت دریافت‌کننده/).fill(recipientId);
  await page
    .getByRole("combobox", { name: "مسئولیت", exact: true })
    .selectOption("PAYMENT_REVIEW");
  await page.getByRole("button", { name: "ادامه: ثبت دلیل و تأیید" }).click();
  await page
    .getByLabel("دلیل داخلی بدون اطلاعات شخصی یا بانکی")
    .fill("نیاز عملیاتی ثبت‌شده برای بررسی تغییر نتیجه پرداخت");
  await page.getByRole("button", { name: "واگذاری مسئولیت" }).click();

  await expect(page.getByText("فعال", { exact: true }).last()).toBeVisible();
  await expect(page.getByText(recipientId)).toHaveCount(0);

  await page
    .getByLabel("دلیل اقدام بدون اطلاعات شخصی یا بانکی")
    .fill("پایان نیاز عملیاتی و لغو فوری اختیار ثبت‌شده");
  await page.getByRole("button", { name: "لغو دسترسی" }).click();
  await expect(page.getByText("لغوشده", { exact: true }).last()).toBeVisible();
  await expect(
    page.getByText("دسترسی لغو شده و از درخواست بعدی قابل استفاده نیست."),
  ).toBeVisible();

  const sensitiveTab = page.getByRole("tab", { name: "دسترسی حساس" });
  await page.getByRole("tab", { name: "مجوزها" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(sensitiveTab).toBeFocused();
  await expect(sensitiveTab).toHaveAttribute("aria-selected", "true");
  await expect(sensitiveTab).toHaveCSS("outline-style", "solid");
  const reducedDuration = await sensitiveTab.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration),
  );
  expect(reducedDuration).toBeLessThan(0.001);
  await assertMinimumContrast(page.getByRole("tab"));
  await assertNoHorizontalOverflow(page);
  await captureReleaseCheckpoint(page, testInfo, {
    cellId: "platform-access-emergency-lifecycle:success",
    name: "platform-access",
    sensitiveRegions: [],
  });
});

test("two managers complete emergency approval, activation, closure, and audit", async ({
  browser,
  context,
  page,
}) => {
  await establishPlatformAgentSession(context, [
    "ACCESS_ADMINISTRATION",
    "ACCESS_AUDIT_REVIEW",
  ]);
  const approverContext = await browser.newContext();
  await establishPlatformAgentSession(approverContext, ["ACCESS_ADMINISTRATION"]);
  const approverPage = await approverContext.newPage();
  const reviewerContext = await browser.newContext();
  await establishPlatformAgentSession(reviewerContext, [
    "ACCESS_ADMINISTRATION",
    "ACCESS_AUDIT_REVIEW",
  ]);
  const reviewerPage = await reviewerContext.newPage();
  const incidentId = `INC-${crypto.randomUUID()}`;
  await page.goto("/platform/access");
  await page.getByRole("tab", { name: "اضطراری" }).click();
  await page.getByText("درخواست دسترسی اضطراری", { exact: true }).first().click();
  await page.getByLabel("شناسه حادثه").fill(incidentId);
  await page.getByRole("button", { name: "ادامه: تعیین دامنه دسترسی" }).click();
  await page.getByLabel("شناسه پرونده").fill(crypto.randomUUID());
  await page
    .getByRole("combobox", { name: "اقدام لازم" })
    .selectOption("CONTAIN_INCIDENT");
  await page.getByRole("button", { name: "ادامه: ثبت دلیل و تأیید" }).click();
  await page
    .getByLabel("دلیل داخلی بدون اطلاعات شخصی یا بانکی")
    .fill("مهار خطر مشخص برای صحت فرایند حیاتی پرداخت");
  await page.getByRole("button", { name: "درخواست دسترسی اضطراری" }).click();

  await expect(
    page.getByText("این درخواست منتظر تأیید یک مدیر دسترسی مستقل است."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "تأیید مستقل" })).toHaveCount(0);

  await approverPage.goto("/platform/access");
  await approverPage.getByRole("tab", { name: "اضطراری" }).click();
  await approverPage.getByRole("button", { name: new RegExp(incidentId) }).click();
  await approverPage.getByRole("button", { name: "تأیید مستقل" }).click();
  await expect(
    approverPage.getByText("تأیید ثبت شد؛ وضعیت تازه نمایش داده می‌شود."),
  ).toBeVisible();

  await page.getByRole("tab", { name: "مجوزها" }).click();
  await page.getByRole("tab", { name: "اضطراری" }).click();
  await page.getByRole("button", { name: new RegExp(incidentId) }).click();
  await expect(
    page.getByText("تأیید مستقل ثبت شده است؛ درخواست‌کننده باید دسترسی را فعال کند."),
  ).toBeVisible();
  await page.getByRole("button", { name: "فعال‌کردن اضطراری" }).click();
  await expect(
    page.getByText("حادثه را مهار کنید؛ سپس دسترسی را ببندید یا فوراً لغو کنید."),
  ).toBeVisible();

  await page
    .getByLabel("دلیل اقدام بدون اطلاعات شخصی یا بانکی")
    .fill("مهار حادثه تکمیل و دسترسی اضطراری بسته شد");
  await page.getByRole("button", { name: "بستن پس از مهار" }).click();
  await expect(page.getByText("بسته‌شده", { exact: true }).last()).toBeVisible();
  await expect(
    page.getByText(
      "دسترسی پایان یافته است؛ بازبین مستقل باید تا مهلت نمایش‌داده‌شده اقدام کند.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ثبت بازبینی پس از حادثه" }),
  ).toHaveCount(0);

  await reviewerPage.goto("/platform/access");
  await reviewerPage.getByRole("tab", { name: "اضطراری" }).click();
  await reviewerPage.getByRole("button", { name: new RegExp(incidentId) }).click();
  await reviewerPage
    .getByRole("combobox", { name: "نتیجه بازبینی" })
    .selectOption("FOLLOW_UP_REQUIRED");
  await reviewerPage.getByRole("button", { name: "ثبت بازبینی پس از حادثه" }).click();
  await expect(reviewerPage.getByText("بازبینی پس از حادثه ثبت شد.")).toBeVisible();

  await page.getByRole("tab", { name: "سابقه" }).click();
  await expect(
    page.getByRole("heading", { name: "سابقه تغییرناپذیر دسترسی" }),
  ).toBeVisible();
  await expect(
    page.getByText("دسترسی اضطراری بسته شد", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("مقدار داده حساس در این سابقه تکرار نمی‌شود."),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await reviewerContext.close();
  await approverContext.close();
});

test("an independent manager rejects a pending sensitive request", async ({
  browser,
  context,
  page,
}) => {
  const requester = await establishPlatformAgentSession(context, [
    "ACCESS_ADMINISTRATION",
    "PAYMENT_REVIEW",
  ]);
  const reviewerContext = await browser.newContext();
  await establishPlatformAgentSession(reviewerContext, [
    "ACCESS_ADMINISTRATION",
    "ACCESS_AUDIT_REVIEW",
  ]);
  const reviewerPage = await reviewerContext.newPage();

  await page.goto("/platform/access");
  await page.getByRole("tab", { name: "دسترسی حساس" }).click();
  await page.getByText("درخواست دسترسی حساس", { exact: true }).first().click();
  await page.getByRole("button", { name: "ادامه: تعیین دامنه دسترسی" }).click();
  await page.getByLabel("شناسه پرونده").fill(crypto.randomUUID());
  await page.getByRole("button", { name: "ادامه: ثبت دلیل و تأیید" }).click();
  await page
    .getByLabel("دلیل داخلی بدون اطلاعات شخصی یا بانکی")
    .fill("درخواست بررسی مستقل برای پرونده حساس با دامنه محدود و ثبت‌شده");
  await page.getByRole("button", { name: "درخواست دسترسی حساس" }).click();

  await reviewerPage.goto("/platform/access");
  await reviewerPage.getByRole("tab", { name: "دسترسی حساس" }).click();
  await reviewerPage
    .getByRole("button", { name: new RegExp(requester.identityId.slice(0, 8)) })
    .click();
  const longReason =
    "دامنه درخواست با نیاز ثبت‌شده این پرونده هم‌خوانی ندارد و باید دوباره محدود شود. ".repeat(
      8,
    );
  await reviewerPage
    .getByLabel("دلیل اقدام بدون اطلاعات شخصی یا بانکی")
    .fill(longReason);
  await reviewerPage.getByRole("button", { name: "رد درخواست" }).click();
  await expect(
    reviewerPage.getByText("درخواست رد شد و از صف اقدام خارج شد."),
  ).toBeVisible();
  await expect(reviewerPage.getByText(requester.identityId)).toHaveCount(0);
  await reviewerPage.getByRole("tab", { name: "سابقه" }).click();
  await expect(reviewerPage.getByText(longReason).first()).toBeVisible();
  await assertNoHorizontalOverflow(reviewerPage);
  await reviewerContext.close();
});
