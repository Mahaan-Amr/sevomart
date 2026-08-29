import { expect, test } from "@playwright/test";

import { establishPlatformAgentSession } from "../helpers/platform-agent-session";

test("platform agent establishes the separate session through the Web journey", async ({
  context,
  page,
}) => {
  await establishPlatformAgentSession(context, ["SELLER_APPLICATION_REVIEW"]);
  await page.route("**/api/platform/auth/otp/requests", (route) =>
    route.fulfill({
      status: 202,
      json: {
        challengeId: "5efea92d-e15f-454e-bc29-0368f667a21d",
        expiresAt: "2026-08-24T09:05:00.000Z",
      },
    }),
  );
  await page.route("**/api/platform/auth/otp/verifications", (route) =>
    route.fulfill({
      status: 200,
      json: {
        actor: {
          identityId: "9921f18f-187f-40dd-a389-1626156366f8",
          audience: "PLATFORM_AGENT",
        },
        permission: "SELLER_APPLICATION_REVIEW",
        expiresAt: "2026-08-24T17:00:00.000Z",
      },
    }),
  );

  await page.goto("/platform/login");
  await page.getByLabel("شماره موبایل").fill("09123456788");
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/platform\/seller-applications$/);
});
