import { randomBytes, scryptSync } from "node:crypto";
import postgres from "postgres";
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
  const identityId = await establishPlatformAgentIdentity(mobile, [
    "SELLER_APPLICATION_REVIEW",
  ]);
  await seedPassword(identityId);

  await page.goto("/platform/login");
  await captureReleaseCheckpoint(page, testInfo, {
    cellId: "platform-agent-sign-in:empty",
    name: "platform-login",
    sensitiveRegions: [],
  });
  await page.getByLabel("نام کاربری، شماره موبایل یا ایمیل").fill(mobile);
  await page.getByLabel("رمز عبور").fill("test platform password");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/platform\/seller-applications$/);
});

test("platform agent resumes the protected responsibility requested before login", async ({
  page,
}, testInfo) => {
  const mobile = iranianMobileContract.parse(
    releaseAgentTestMobiles[visualProjectIndex(testInfo.project.name) + 8],
  );
  const identityId = await establishPlatformAgentIdentity(mobile, [
    "SELLER_APPLICATION_REVIEW",
    "PAYMENT_REVIEW",
  ]);
  await seedPassword(identityId);

  await page.goto("/platform/payment-reviews");
  await expect(page).toHaveURL(
    /\/platform\/login\?returnTo=%2Fplatform%2Fpayment-reviews$/,
  );
  await page.getByLabel("نام کاربری، شماره موبایل یا ایمیل").fill(mobile);
  await page.getByLabel("رمز عبور").fill("test platform password");
  await page.getByRole("button", { name: "ورود" }).click();

  await expect(page).toHaveURL(/\/platform\/payment-reviews$/);
});

async function seedPassword(identityId: string) {
  const sql = postgres(
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo",
    { max: 1 },
  );
  const salt = randomBytes(16).toString("base64url");
  const key = scryptSync("test platform password", salt, 64, {
    N: 16384,
    r: 8,
    p: 5,
    maxmem: 64 * 1024 * 1024,
  }).toString("base64url");
  try {
    await sql`insert into identity_platform_passwords (identity_id, username, password_hash) values (${identityId}, ${`test${identityId.replaceAll("-", "")}`}, ${`scrypt$${salt}$${key}`})`;
  } finally {
    await sql.end();
  }
}
