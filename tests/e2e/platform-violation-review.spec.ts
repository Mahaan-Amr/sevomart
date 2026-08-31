import { expect, test } from "@playwright/test";

import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import { establishPlatformAgentSession } from "../helpers/platform-agent-session";

const violationCaseId = "5df3e69a-4d9c-4c5b-9bf2-75af372e18e4";
const grantId = "555c67ad-b996-4165-b639-ce080f7a0225";

test.beforeEach(async ({ context }) => {
  await establishPlatformAgentSession(context, ["VIOLATION_REVIEW"]);
});

test("keeps violation evidence masked until an audited case-scoped reveal", async ({
  page,
}) => {
  let revealHeaders: Record<string, string> = {};
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/platform/violations**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith(violationCaseId)) {
      revealHeaders = request.headers();
      await route.fulfill({ status: 200, json: violationDetail() });
      return;
    }
    await route.fulfill({
      status: 200,
      json: { items: [violationSummary()], nextCursor: null },
    });
  });

  await page.goto("/platform/violations");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "پرونده‌های تخلف نیازمند بررسی" }),
  ).toBeVisible();
  await expect(page.getByText("عدم رعایت تعهد انجام سفارش")).toBeVisible();
  await expect(page.getByText("مدرک تصویری")).toHaveCount(0);
  await expect(page.getByText(grantId)).toHaveCount(0);

  await page.getByRole("button", { name: /بررسی پرونده/ }).click();
  await expect(page.getByText("جزئیات حساس هنوز آشکار نشده‌اند.")).toBeVisible();
  await page.getByLabel("شناسه اجازه دسترسی فعال").fill(grantId);
  await page
    .getByLabel("دلیل مشاهده")
    .fill("بررسی مدرک پرونده تخلف برای تعیین اقدام بعدی");
  const reveal = page.getByRole("button", { name: "آشکارسازی حداقل لازم" });
  await assertMinimumContrast(reveal);
  await reveal.click();

  await expect(page.getByText("مدرک تصویری")).toBeVisible();
  await expect(page.getByText("مشاهده ثبت و ممیزی شد.")).toBeVisible();
  expect(revealHeaders["x-platform-access-grant-id"]).toBe(grantId);
  expect(decodeURIComponent(revealHeaders["x-platform-access-reason"]!)).toBe(
    "بررسی مدرک پرونده تخلف برای تعیین اقدام بعدی",
  );
  await assertNoHorizontalOverflow(page);
});

test("does not expose the violation route or navigation without its responsibility", async ({
  context,
  page,
}) => {
  await context.clearCookies();
  await establishPlatformAgentSession(context, ["DISPUTE_REVIEW"]);

  await page.goto("/platform/violations");

  await expect(
    page.getByRole("heading", { name: "این مسئولیت دیگر در دسترس نیست" }),
  ).toBeVisible();
  await expect(page.getByText("تخلف‌ها")).toHaveCount(0);
});

function violationSummary() {
  return {
    violationCaseId,
    type: "FULFILLMENT_NONCOMPLIANCE",
    source: {
      kind: "DISPUTE",
      disputeId: "00000000-0000-4000-8000-000000000012",
    },
    status: "OPEN",
    openedAt: "2026-08-31T08:00:00.000Z",
    deadlineAt: "2026-09-02T08:00:00.000Z",
    nextActionCode: "REVIEW_EVIDENCE",
  };
}

function violationDetail() {
  return {
    ...violationSummary(),
    evidence: [
      {
        evidenceId: "00000000-0000-4000-8000-000000000015",
        kind: "IMAGE",
        submittedAt: "2026-08-31T08:05:00.000Z",
      },
    ],
    actionReasonCodes: ["VIOLATION_RECORDED"],
    access: {
      grantId,
      mode: "REVEALED_MINIMUM",
      scope: {
        resourceType: "VIOLATION_CASE",
        resourceId: violationCaseId,
        allowedActions: ["REVEAL_MINIMUM"],
      },
      accessedAt: "2026-08-31T08:10:00.000Z",
      expiresAt: "2026-08-31T08:40:00.000Z",
    },
  };
}
