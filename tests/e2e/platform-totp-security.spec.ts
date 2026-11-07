import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { assertMinimumContrast } from "../helpers/visual-assertions";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import postgres from "postgres";

test.skip(
  process.env.SEVO_SECURITY_E2E !== "1",
  "Requires a dedicated empty security test database and running API/Web services",
);
test("real agents enroll, approve recovery, and revoke sessions across responsive layouts", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const api = process.env.SECURITY_API_URL ?? "http://127.0.0.1:3211";
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("An isolated DATABASE_URL is required");
  const mobiles = ["09123456788", "09123456787", "09123456786"];
  async function publicLogin(mobile: string) {
    const sent = await request.post(`${api}/v1/auth/otp/requests`, {
      data: { mobile },
    });
    expect(sent.status()).toBe(202);
    const verified = await request.post(`${api}/v1/auth/otp/verifications`, {
      data: { challengeId: (await sent.json()).challengeId, code: "111111" },
    });
    expect(verified.status()).toBe(200);
    return (await verified.json()).actor.identityId as string;
  }
  const [first, second, target] = await Promise.all(mobiles.map(publicLogin));
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`insert into identity_platform_permission_grants (id, identity_id, permission, granted_at) values (${randomUUID()}, ${target}, 'SELLER_APPLICATION_REVIEW', now())`;
    execFileSync(
      process.execPath,
      [
        "scripts/bootstrap-platform-totp.mjs",
        "--first",
        first!,
        "--second",
        second!,
        "--reason",
        "Independent test identity checks",
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" },
    );
    async function agentPage(mobile: string, width: number) {
      const sent = await request.post(`${api}/v1/platform/auth/otp/requests`, {
        data: { mobile },
      });
      const verified = await request.post(`${api}/v1/platform/auth/otp/verifications`, {
        data: { challengeId: (await sent.json()).challengeId, code: "111111" },
      });
      expect(verified.status()).toBe(200);
      const responseHeaders = verified.headers();
      const token = responseHeaders["set-cookie"]!.match(
        /sevo_platform_session=([^;]+)/,
      )![1]!;
      const context = await browser.newContext({
        viewport: { width, height: 850 },
        locale: "fa-IR",
        reducedMotion: "reduce",
      });
      await context.addCookies([
        {
          name: "sevo_platform_session",
          value: token,
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      return { context, page: await context.newPage() };
    }
    const a = await agentPage(mobiles[0]!, 375);
    const b = await agentPage(mobiles[1]!, 1100);
    const c = await agentPage(mobiles[2]!, 375);
    async function enroll(agent: typeof a) {
      await agent.page.goto("/platform/security/authenticator");
      await expect(agent.page.locator("html")).toHaveAttribute("dir", "rtl");
      await agent.page.getByRole("button", { name: "شروع ثبت برنامه" }).click();
      const secret = await agent.page.locator("code").innerText();
      const asciiCode = totp(secret);
      await agent.page
        .getByLabel("کد برنامه تأیید")
        .fill(asciiCode.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]!));
      await expect(agent.page.getByLabel("کد برنامه تأیید")).toHaveValue(asciiCode);
      await agent.page.getByRole("button", { name: "تأیید و فعال‌کردن" }).click();
      await expect(agent.page.getByRole("status")).toContainText(
        "برنامه تأیید فعال شد",
      );
      expect(
        await agent.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      return secret;
    }
    const firstSecret = await enroll(a);
    const secondSecret = await enroll(b);
    await c.page.goto("/platform/security/recovery");
    await c.page.getByLabel("شناسه پیگیری").fill("INC-TEST");
    await c.page.getByLabel("دلیل درخواست").fill("دستگاه قبلی در دسترس نیست");
    await c.page.getByRole("button", { name: "ثبت درخواست" }).click();
    await expect(c.page.getByLabel("شناسه درخواست")).toHaveValue(/^[a-f0-9-]{36}$/);
    const recoveryId = await c.page.getByLabel("شناسه درخواست").inputValue();
    async function approve(agent: typeof a, secret: string) {
      await agent.page.goto("/platform/security/approvals");
      await agent.page.getByLabel("شناسه درخواست").fill(recoveryId);
      await agent.page.getByRole("button", { name: "دیدن درخواست" }).click();
      await expect(agent.page.getByText("دستگاه قبلی در دسترس نیست")).toBeVisible();
      await agent.page.getByLabel("کد برنامه تأیید").fill(totp(secret, 1));
      await agent.page.getByRole("button", { name: "تأیید هویت و درخواست" }).click();
      await expect(agent.page.getByRole("status")).toContainText("تأیید شما ثبت شد");
    }
    await approve(a, firstSecret);
    await approve(b, secondSecret);
    await c.page.getByRole("button", { name: "ادامه پس از تأیید دو مدیر" }).click();
    const replacement = await c.page.locator("code").innerText();
    await c.page.getByLabel("کد برنامه تأیید").fill(totp(replacement));
    await c.page.getByRole("button", { name: "تأیید برنامه تازه" }).click();
    await expect(c.page.getByRole("status")).toContainText("برنامه تازه فعال شد");
    await sql`insert into identity_platform_permission_grants (id, identity_id, permission, granted_at) values (${randomUUID()}, ${target}, 'SESSION_SECURITY', now())`;
    await c.page.goto("/platform/security/sessions");
    await expect(c.page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(
      await c.page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
    await c.page.getByLabel("شناسه هویت").focus();
    await c.page.keyboard.press("Tab");
    await expect(c.page.getByLabel("شناسه حادثه")).toBeFocused();
    await expect(c.page.getByLabel("شناسه حادثه")).toHaveCSS("outline-style", "solid");
    expect(
      (await c.page.getByRole("button", { name: "بستن نشست‌ها" }).boundingBox())!
        .height,
    ).toBeGreaterThanOrEqual(40);
    await assertMinimumContrast(c.page.getByRole("button", { name: "بستن نشست‌ها" }));
    const accessibility = await new AxeBuilder({ page: c.page })
      .include("main")
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await c.page.getByLabel("شناسه هویت").fill(first!);
    await c.page.getByLabel("شناسه حادثه").fill("INC-TEST-SESSION");
    await c.page.getByLabel("دلیل اقدام").fill("بررسی نشست مشکوک");
    await c.page.getByLabel("کد برنامه تأیید").fill(totp(replacement, 1));
    await c.page.getByRole("button", { name: "بستن نشست‌ها" }).click();
    await expect(c.page.getByRole("status")).toContainText("نشست‌های فعلی بسته شدند");
    expect(
      await c.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await Promise.all([a.context.close(), b.context.close(), c.context.close()]);
  } finally {
    await sql.end();
  }
});
function totp(secret: string, step = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const bytes = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((part) => parseInt(part, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + step));
  const hash = createHmac("sha1", bytes).update(counter).digest();
  const offset = hash[19]! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
