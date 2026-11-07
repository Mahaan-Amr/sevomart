import { randomUUID, scryptSync } from "node:crypto";
import postgres from "postgres";
import { test, expect } from "@playwright/test";

test("platform colleague signs in with a username and password", async ({ page }) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const identity = randomUUID();
  const username = `test${identity.replaceAll("-", "")}`;
  const salt = Buffer.alloc(16, 5).toString("base64url");
  const key = scryptSync("browser secure password", salt, 64, {
    N: 16384,
    r: 8,
    p: 5,
    maxmem: 64 * 1024 * 1024,
  }).toString("base64url");
  try {
    await sql`insert into identity_identities (id, status) values (${identity}, 'ACTIVE')`;
    await sql`insert into identity_platform_permission_grants (id, identity_id, permission, granted_at) values (${randomUUID()}, ${identity}, 'SELLER_APPLICATION_REVIEW', now())`;
    await sql`insert into identity_platform_passwords (identity_id, username, password_hash) values (${identity}, ${username}, ${`scrypt$${salt}$${key}`})`;
    await page.goto("/platform/login");
    await page.getByLabel("نام کاربری، شماره موبایل یا ایمیل").fill(username);
    await page.getByLabel("رمز عبور").fill("browser secure password");
    await page.getByRole("button", { name: "ورود" }).click();
    await expect(page).toHaveURL(/\/platform(?:\/seller-applications)?$/);
  } finally {
    await sql`delete from identity_sessions where identity_id = ${identity}`;
    await sql`delete from identity_platform_permission_grants where identity_id = ${identity}`;
    await sql`delete from identity_identities where id = ${identity}`;
    await sql.end();
  }
});
test("superadmin gives a one-time recovery code to a colleague", async ({ page }) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const admin = randomUUID(),
    colleague = randomUUID();
  const suffix = randomUUID().replaceAll("-", "");
  const adminName = `admin${suffix}`,
    colleagueName = `colleague${suffix}`;
  const salt = Buffer.alloc(16, 6).toString("base64url");
  const key = scryptSync("browser old password", salt, 64, {
    N: 16384,
    r: 8,
    p: 5,
    maxmem: 64 * 1024 * 1024,
  }).toString("base64url");
  try {
    await sql`insert into identity_identities (id, status) values (${admin}, 'ACTIVE'), (${colleague}, 'ACTIVE')`;
    await sql`insert into identity_platform_superadmins (identity_id, granted_at) values (${admin}, now())`;
    await sql`insert into identity_platform_permission_grants (id, identity_id, permission, granted_at) values (${randomUUID()}, ${colleague}, 'SELLER_APPLICATION_REVIEW', now())`;
    await sql`insert into identity_platform_passwords (identity_id, username, password_hash) values (${admin}, ${adminName}, ${`scrypt$${salt}$${key}`}), (${colleague}, ${colleagueName}, ${`scrypt$${salt}$${key}`})`;
    await page.goto("/platform/login");
    await page.getByLabel("نام کاربری، شماره موبایل یا ایمیل").fill(adminName);
    await page.getByLabel("رمز عبور").fill("browser old password");
    await page.getByRole("button", { name: "ورود" }).click();
    await expect(page).toHaveURL(/\/platform(?:\/seller-applications)?$/);
    await page.goto("/platform/access/recovery");
    await page.getByLabel("شناسه همکار").fill(colleague);
    await page.getByLabel("ایمیل همکار (اختیاری)").fill(`${suffix}@example.test`);
    await page.getByLabel("دلیل بازیابی").fill("بازیابی دسترسی همکار مجاز");
    await page.getByRole("button", { name: "دریافت کد بازیابی" }).click();
    const code = await page.locator("bdi").last().innerText();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await page.getByRole("button", { name: "کد را رساندم" }).click();
    await expect(page.locator("bdi").filter({ hasText: code })).toHaveCount(0);
    await page.goto("/platform/login/recovery");
    await page.getByLabel("کد بازیابی").fill(code);
    await page.getByLabel("رمز تازه").fill("browser new secure password");
    await page.getByRole("button", { name: "ثبت رمز تازه" }).click();
    await expect(page.getByRole("status")).toContainText("رمز تازه ثبت شد");
    await page.goto("/platform/login");
    await page
      .getByLabel("نام کاربری، شماره موبایل یا ایمیل")
      .fill(`${suffix}@example.test`);
    await page.getByLabel("رمز عبور").fill("browser new secure password");
    await page.getByRole("button", { name: "ورود" }).click();
    await expect(page).toHaveURL(/\/platform(?:\/seller-applications)?$/);
  } finally {
    await sql`delete from identity_platform_password_recoveries where identity_id = ${colleague}`;
    await sql`delete from identity_sessions where identity_id in (${admin}, ${colleague})`;
    await sql`delete from identity_platform_permission_grants where identity_id = ${colleague}`;
    await sql`delete from identity_platform_superadmins where identity_id = ${admin}`;
    await sql`delete from identity_platform_passwords where identity_id in (${admin}, ${colleague})`;
    await sql.end();
  }
});
