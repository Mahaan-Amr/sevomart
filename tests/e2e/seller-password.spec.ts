import postgres from "postgres";
import { expect, test } from "../helpers/release-playwright";
import { createRequire } from "node:module";

const { createActiveSellerFixture } = createRequire(import.meta.url)(
  "../../apps/api/src/modules/identity-access/testing/active-seller.fixture",
) as typeof import("../../apps/api/src/modules/identity-access/testing/active-seller.fixture");
import {
  sellerPasswordTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("password form shows Persian errors beside their fields", async ({ page }) => {
  await page.goto("/seller/login");
  await page.getByRole("button", { name: "ورود با رمز" }).click();
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  const mobile = page.getByLabel("شماره موبایل");
  const password = page.getByLabel("رمز", { exact: true });
  await expect(mobile).toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("شماره موبایل را با قالب ۰۹xxxxxxxxx وارد کنید."),
  ).toBeVisible();
  await expect(page.getByText("رمز باید بین ۱۲ تا ۱۲۸ نویسه باشد.")).toBeVisible();
  await expect(mobile).toHaveAttribute("aria-describedby", "password-mobile-error");
  await expect(password).toHaveAttribute("aria-describedby", "seller-password-error");
  await page.getByRole("button", { name: "رمزم را فراموش کرده‌ام" }).click();
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await expect(page.getByLabel("شماره موبایل")).toHaveAttribute("aria-invalid", "true");
});
import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";

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
    await page
      .getByLabel("شماره موبایل")
      .fill(mobile.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d))));
    await page.getByLabel("رمز", { exact: true }).fill("a secure seller password");
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await expect(page.getByRole("heading", { name: "وارد شدید" })).toBeVisible();
    await page.getByRole("button", { name: "خروج", exact: true }).click();
    await page.getByRole("button", { name: "ورود با رمز" }).click();
    await page.getByRole("button", { name: "رمزم را فراموش کرده‌ام" }).click();
    await page.getByLabel("شماره موبایل").fill(mobile);
    await page.getByRole("button", { name: "دریافت کد" }).click();
    await page.getByRole("button", { name: "تغییر رمز" }).click();
    await expect(page.getByLabel("کد شش‌رقمی")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("کد شش‌رقمی را کامل وارد کنید.")).toBeVisible();
    await page.getByLabel("کد شش‌رقمی").fill("١١١١١١");
    await page.getByLabel("رمز تازه، حداقل ۱۲ نویسه").fill("another secure password");
    await page.getByRole("button", { name: "تغییر رمز" }).click();
    await expect(page.getByRole("status")).toContainText("نشست‌های عمومی");
    expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
    await assertNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "بازگشت به ورود" }).click();
    await page.getByRole("button", { name: "ورود با رمز" }).click();
    await page.getByLabel("شماره موبایل").fill(mobile);
    const passwordInput = page.getByLabel("رمز", { exact: true });
    await passwordInput.focus();
    await expect(passwordInput).toHaveCSS("outline-style", "solid");
    expect(
      Number.parseFloat(
        await passwordInput.evaluate(
          (element) => getComputedStyle(element).transitionDuration,
        ),
      ),
    ).toBeLessThan(0.001);
    await passwordInput.fill("another secure password");
    const submit = page.getByRole("button", { name: "ورود", exact: true });
    await assertMinimumContrast(submit);
    await submit.click();
    await expect(page.getByRole("heading", { name: "وارد شدید" })).toBeVisible();
  } finally {
    await sql`delete from identity_seller_passwords where identity_id = ${identityId}`;
    await sql`delete from identity_password_attempts where mobile = ${mobile}`;
    await sql.end();
    await fixture.cleanup();
  }
});
