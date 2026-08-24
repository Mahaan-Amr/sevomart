import { expect, test } from "@playwright/test";

import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";

test("platform agent reviews a Persian RTL application on the approved compact workspace", async ({
  page,
}) => {
  let application = sellerApplication();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/platform/seller-applications**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST") {
      const body = request.postDataJSON() as {
        publicReason: string;
        requestedFields: string[];
      };
      application = {
        ...application,
        status: "NEEDS_INFORMATION",
        revision: 2,
        decisions: [
          {
            action: "REQUEST_INFORMATION",
            reasonCode: "INFORMATION_INCOMPLETE",
            publicReason: body.publicReason,
            internalNote: null,
            requestedFields: body.requestedFields,
            actorIdentityId: "9921f18f-187f-40dd-a389-1626156366f8",
            revision: 2,
            occurredAt: "2026-08-24T09:00:00.000Z",
          },
        ],
      };
      await route.fulfill({ status: 200, json: application });
      return;
    }
    if (pathname.endsWith(application.applicationId)) {
      await route.fulfill({ status: 200, json: application });
      return;
    }
    if (new URL(request.url()).searchParams.has("cursor")) {
      await route.fulfill({ status: 200, json: { items: [], nextCursor: null } });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        items: [
          {
            applicationId: application.applicationId,
            applicantName: application.currentPayload.applicantName,
            proposedStoreName: application.currentPayload.proposedStoreName,
            status: application.status,
            revision: application.revision,
            lastSubmittedAt: application.lastSubmittedAt,
          },
        ],
        nextCursor: "next-page",
      },
    });
  });

  await page.goto("/platform/seller-applications");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "بررسی درخواست‌های فروشندگی" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "خانه ماه" })).toBeVisible();
  await expect(page.getByText("09123456789")).toHaveCount(0);
  await assertNoHorizontalOverflow(page);

  const queueItem = page.getByRole("button", { name: /خانه ماه/ });
  await queueItem.focus();
  await expect(queueItem).toHaveCSS("outline-style", "solid");
  const loadMore = page.getByRole("button", { name: "نمایش درخواست‌های بیشتر" });
  await loadMore.click();
  await expect(loadMore).toHaveCount(0);
  await page.getByLabel("کد دلیل").selectOption("OTHER");
  const reason = page.getByLabel("دلیل قابل‌نمایش به متقاضی");
  await reason.fill("لطفاً روش فعلی فروش را روشن‌تر توضیح دهید.");
  const submit = page.getByRole("button", { name: "ثبت درخواست تکمیل" });
  await assertMinimumContrast(submit);
  await submit.click();

  await expect(page.getByText("این درخواست اکنون قابل تصمیم‌گیری نیست")).toBeVisible();
  await expect(page.getByText("نیاز به تکمیل").first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("shows a self-owned application read-only and asks for handoff", async ({
  page,
}) => {
  const application = { ...sellerApplication(), isSelfReview: true };
  await page.route("**/api/platform/seller-applications**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    await route.fulfill({
      status: 200,
      json: pathname.endsWith(application.applicationId)
        ? application
        : {
            items: [
              {
                applicationId: application.applicationId,
                applicantName: application.currentPayload.applicantName,
                proposedStoreName: application.currentPayload.proposedStoreName,
                status: application.status,
                revision: application.revision,
                lastSubmittedAt: application.lastSubmittedAt,
              },
            ],
            nextCursor: null,
          },
    });
  });

  await page.goto("/platform/seller-applications");
  await expect(page.getByText(/برای تصمیم به عامل دیگری بسپارید/)).toBeVisible();
  await expect(page.getByRole("button", { name: "ثبت درخواست تکمیل" })).toHaveCount(0);
});

function sellerApplication() {
  return {
    applicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
    isSelfReview: false,
    status: "SUBMITTED" as "SUBMITTED" | "NEEDS_INFORMATION",
    revision: 1,
    payloadRevision: 1,
    currentPayload: {
      applicantName: "نگار محمدی",
      proposedStoreName: "خانه ماه",
      goodsAreaText: "سفال دست‌ساز",
      currentSalesMethod: "فروش از راه اینستاگرام و پیام مستقیم",
    },
    createdAt: "2026-08-24T08:00:00.000Z",
    lastSubmittedAt: "2026-08-24T08:00:00.000Z",
    decisions: [] as Array<{
      action: "REQUEST_INFORMATION";
      reasonCode: "INFORMATION_INCOMPLETE";
      publicReason: string;
      internalNote: null;
      requestedFields: string[];
      actorIdentityId: string;
      revision: number;
      occurredAt: string;
    }>,
  };
}
