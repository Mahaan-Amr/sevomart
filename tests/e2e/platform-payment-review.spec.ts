import { expect, test } from "../helpers/release-playwright";
import { captureReleaseCheckpoint } from "../helpers/release-checkpoint";

import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import { establishPlatformAgentSession } from "../helpers/platform-agent-session";

const reviewId = "91fe87eb-6c0f-47ca-93ca-9f9a038ca273";
const grantId = "81fe87eb-6c0f-47ca-93ca-9f9a038ca271";

test("payment review stays low-detail until an audited reveal and never offers a manual outcome", async ({
  context,
  page,
}, testInfo) => {
  await establishPlatformAgentSession(context, ["PAYMENT_REVIEW"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/platform/payment-reviews**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/${reviewId}/reveal`)) {
      await route.fulfill({
        json: {
          reviewId,
          orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
          status: "REVIEW_REQUIRED",
          amount: { amount: 4_500_000, currency: "IRR" },
          provider: "DEV",
          providerReference: "provider-reference-151",
          reviewKind: "RESULT_AMBIGUOUS",
          alertKinds: ["RECONCILIATION_OVERDUE"],
          observations: [
            {
              providerEventId: "provider-event-151-with-a-long-safe-reference",
              providerReference: "provider-reference-151",
              result: "PENDING",
              observedAt: "2026-08-25T08:01:00.000Z",
            },
          ],
          audits: [
            {
              fromStatus: "DISPATCHED",
              toStatus: "REVIEW_REQUIRED",
              reasonCode: "PROVIDER_RESULT_PENDING",
              occurredAt: "2026-08-25T08:01:00.000Z",
            },
          ],
          reconciliationCount: 2,
          nextReconciliationAt: "2026-08-25T08:05:00.000Z",
          revealedAt: "2026-08-25T08:02:00.000Z",
          accessExpiresAt: "2026-08-25T08:30:00.000Z",
        },
      });
      return;
    }
    if (path.endsWith(`/${reviewId}/reconciliation`)) {
      await route.fulfill({
        status: 202,
        json: { reviewId, requestedAt: "2026-08-25T08:03:00.000Z" },
      });
      return;
    }
    await route.fulfill({
      json: {
        items: [
          {
            reviewId,
            reviewKind: "RESULT_AMBIGUOUS",
            amount: { amount: 4_500_000, currency: "IRR" },
            provider: "DEV",
            openedAt: "2026-08-25T08:01:00.000Z",
            needsFollowUp: true,
          },
        ],
      },
    });
  });

  await page.goto("/platform/payment-reviews");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("provider-reference-151")).toHaveCount(0);
  const openCase = page.getByRole("link", { name: "بازکردن پرونده" });
  await openCase.focus();
  await expect(openCase).toHaveCSS("outline-style", "solid");
  await openCase.click();

  await page.getByLabel("شناسه اجازه دسترسی حساس").fill(grantId);
  await page
    .getByLabel("دلیل مشاهده این پرونده")
    .fill("بررسی مدرک درگاه برای این پرونده پرداخت مشخص");
  const reveal = page.getByRole("button", { name: "آشکارکردن اطلاعات پرونده" });
  await reveal.focus();
  await expect(reveal).toHaveCSS("outline-style", "solid");
  await reveal.click();

  await expect(page.getByText("provider-reference-151")).toBeVisible();
  await expect(page.getByText(/این مشاهده تا/)).toBeVisible();
  await expect(page.getByRole("button", { name: /موفق/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /ناموفق/ })).toHaveCount(0);
  const reconcile = page.getByRole("button", {
    name: "درخواست تطبیق دوباره از درگاه",
  });
  await expect(reconcile).toBeVisible();
  await assertMinimumContrast(reconcile);
  await reconcile.click();
  await expect(
    page.getByText(/نتیجه فقط پس از پاسخ معتبر درگاه تغییر می‌کند/),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await captureReleaseCheckpoint(page, testInfo, {
    cellId: "platform-payment-review:success",
    name: "platform-payment-review",
    sensitiveRegions: [page.getByText(/provider-reference|provider-event/)],
  });
});
