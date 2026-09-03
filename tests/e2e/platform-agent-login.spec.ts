import { expect, test } from "../helpers/release-playwright";
import { captureReleaseCheckpoint } from "../helpers/release-checkpoint";
import { iranianMobileContract } from "@sevo/contracts/identity-access/v1";

import {
  releaseAgentTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";
import { establishPlatformAgentIdentity } from "../helpers/platform-agent-session";

test("platform agent establishes the separate session through the Web journey", async ({
  page,
}, testInfo) => {
  const mobile = iranianMobileContract.parse(
    releaseAgentTestMobiles[visualProjectIndex(testInfo.project.name) + 4],
  );
  await establishPlatformAgentIdentity(mobile, ["SELLER_APPLICATION_REVIEW"]);

  await page.goto("/platform/login");
  await captureReleaseCheckpoint(page, testInfo, {
    cellId: "platform-agent-sign-in:empty",
    name: "platform-login",
    sensitiveRegions: [],
  });
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/platform\/seller-applications$/);
});

test("platform agent resumes the protected responsibility requested before login", async ({
  page,
}, testInfo) => {
  const mobile = iranianMobileContract.parse(
    releaseAgentTestMobiles[visualProjectIndex(testInfo.project.name) + 8],
  );
  await establishPlatformAgentIdentity(mobile, [
    "SELLER_APPLICATION_REVIEW",
    "PAYMENT_REVIEW",
  ]);

  await page.goto("/platform/payment-reviews");
  await expect(page).toHaveURL(
    /\/platform\/login\?returnTo=%2Fplatform%2Fpayment-reviews$/,
  );
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();

  await expect(page).toHaveURL(/\/platform\/payment-reviews$/);
});
