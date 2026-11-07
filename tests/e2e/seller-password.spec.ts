import postgres from "postgres";
import { expect, test } from "../helpers/release-playwright";
import { createActiveSellerFixture } from "../../apps/api/src/modules/identity-access/testing/active-seller.fixture";
import {
  sellerPasswordTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("seller creates, uses, and recovers an optional password", async ({
  page,
}, testInfo) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const mobile = sellerPasswordTestMobiles[visualProjectIndex(testInfo.project.name)]!;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/seller/login");
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/auth/otp/verifications") && r.status() === 200,
  );
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  const identityId = (await (await response).json()).actor.identityId;
  const fixture = await createActiveSellerFixture(databaseUrl, identityId);
  const sql = postgres(databaseUrl);
  try {
    await sql`delete from identity_seller_passwords where identity_id = ${identityId}`;
    await sql`delete from identity_password_attempts where mobile = ${mobile}`;
    await page.getByRole("button", { name: "ساخت رمز اختیاری" }).click();
    await page.getByLabel("رمز تازه، حداقل ۱۲ نویسه").fill("a secure seller password");
    await page.getByRole("button", { name: "ساخت رمز", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("رمز ساخته شد");
    await page.getByRole("button", { name: "بازگشت به ورود" }).click();
    await page.getByRole("button", { name: "خروج", exact: true }).click();
    await page.getByRole("button", { name: "ورود با رمز" }).click();
    await page.getByLabel("شماره موبایل").fill(mobile);
    await page.getByLabel("رمز", { exact: true }).fill("a secure seller password");
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await expect(page.getByRole("heading", { name: "وارد شدید" })).toBeVisible();
    await page.getByRole("button", { name: "خروج", exact: true }).click();
    await page.getByRole("button", { name: "ورود با رمز" }).click();
    await page.getByRole("button", { name: "رمزم را فراموش کرده‌ام" }).click();
    await page.getByLabel("شماره موبایل").fill(mobile);
    await page.getByRole("button", { name: "دریافت کد" }).click();
    await page.getByLabel("کد شش‌رقمی").fill("111111");
    await page.getByLabel("رمز تازه، حداقل ۱۲ نویسه").fill("another secure password");
    await page.getByRole("button", { name: "تغییر رمز" }).click();
    await expect(page.getByRole("status")).toContainText("نشست‌های عمومی");
    expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
  } finally {
    await sql`delete from identity_seller_passwords where identity_id = ${identityId}`;
    await sql`delete from identity_password_attempts where mobile = ${mobile}`;
    await sql.end();
    await fixture.cleanup();
  }
});
