import { randomUUID } from "node:crypto";

import { expect, test } from "../helpers/release-playwright";
import postgres from "postgres";
import { captureReleaseCheckpoint } from "../helpers/release-checkpoint";

import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import { establishPlatformAgentSession } from "../helpers/platform-agent-session";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";

test("a dispute agent requests timed access and records an audited result", async ({
  newCandidateContext,
  context,
  page,
}, testInfo) => {
  const agent = await establishPlatformAgentSession(context, ["DISPUTE_REVIEW"]);
  const managerContext = await newCandidateContext();
  await establishPlatformAgentSession(managerContext, ["ACCESS_ADMINISTRATION"]);
  const managerPage = await managerContext.newPage();
  const dispute = await seedDispute();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/platform/disputes");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "رسیدگی به اختلاف‌ها" }),
  ).toBeVisible();
  await expect(page.getByText("کالا آسیب‌دیده", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(dispute.buyerText)).toHaveCount(0);
  await page
    .getByLabel("صف اختلاف‌ها")
    .getByRole("button", {
      name: new RegExp(`پرونده ${dispute.id.slice(0, 8)}`),
    })
    .click();

  const requestAccess = page.getByRole("button", {
    name: "درخواست دسترسی ۳۰ دقیقه‌ای",
  });
  const accessReason = page.getByLabel("دلیل داخلی درخواست دسترسی");
  await accessReason.fill("بررسی مدارک همین پرونده برای ثبت نتیجه قابل پیگیری");
  await accessReason.focus();
  await page.keyboard.press("Tab");
  await expect(requestAccess).toBeFocused();
  await expect(requestAccess).toHaveCSS("outline-style", "solid");
  await assertMinimumContrast(requestAccess);
  await requestAccess.click();
  await expect(
    page.getByText(
      "درخواست ثبت شد. پس از تأیید مدیر دسترسی، پرونده را دوباره باز کنید.",
    ),
  ).toBeVisible();

  await managerPage.goto("/platform/access");
  await managerPage.getByRole("tab", { name: "دسترسی حساس" }).click();
  await managerPage
    .getByRole("button", { name: new RegExp(agent.identityId.slice(0, 8)) })
    .click();
  await managerPage.getByRole("button", { name: "تأیید مستقل" }).click();
  await expect(
    managerPage.getByText("تأیید ثبت شد؛ وضعیت تازه نمایش داده می‌شود."),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: new RegExp(`بازکردن پرونده ${dispute.id.slice(0, 8)}`),
    })
    .click();
  await expect(page.getByText(dispute.buyerText)).toBeVisible();
  await expect(page.getByText("دسترسی تا", { exact: true })).toBeVisible();
  await expect(page.getByText(dispute.buyerId)).toHaveCount(0);

  await page
    .getByLabel("توضیح نتیجه برای دو طرف")
    .fill("مدارک بررسی شد و دو طرف درباره قدم بعدی به توافق رسیدند.");
  await page.getByRole("button", { name: "ثبت نتیجه" }).click();
  await expect(
    page.getByText("نتیجه با دلیل ثبت شد؛ این نتیجه تضمین بازپرداخت نیست."),
  ).toBeVisible();
  await expect(page.getByText("حل‌شده", { exact: true }).first()).toBeVisible();

  await assertNoHorizontalOverflow(page);
  await captureReleaseCheckpoint(page, testInfo, {
    cellId: "platform-dispute-review:success",
    name: "platform-dispute-review",
    sensitiveRegions: [page.locator("main img, main video")],
  });
  await managerContext.close();
});

async function seedDispute() {
  const fixture = {
    id: randomUUID(),
    orderId: randomUUID(),
    buyerId: randomUUID(),
    sellerId: randomUUID(),
    storeId: randomUUID(),
    buyerText:
      "بسته هنگام تحویل آسیب داشت و تصویر وضعیت کالا برای بررسی ثبت شده است. ".repeat(
        8,
      ),
  };
  const openedAt = new Date();
  const respondedAt = new Date(openedAt.getTime() + 1_000);
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`
      insert into problem_disputes
        (id, order_id, buyer_identity_id, store_id, status, category,
         opened_at, deadline_kind, deadline_at, contributions, outcome,
         version, updated_at)
      values
        (${fixture.id}, ${fixture.orderId}, ${fixture.buyerId}, ${fixture.storeId},
         'UNDER_REVIEW', 'DAMAGED', ${openedAt}, null, null, ${sql.json([
           {
             authorKind: "BUYER",
             text: fixture.buyerText,
             evidence: [],
             submittedAt: openedAt.toISOString(),
           },
           {
             authorKind: "SELLER",
             text: "پاسخ فروشنده برای بررسی پلتفرم ثبت شد.",
             evidence: [],
             submittedAt: respondedAt.toISOString(),
           },
         ])}, null, 2, ${respondedAt})
    `;
  } finally {
    await sql.end();
  }
  return fixture;
}
