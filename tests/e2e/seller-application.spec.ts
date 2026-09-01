import { createHash, randomBytes, randomUUID } from "node:crypto";

import { expect, test, type BrowserContext } from "../helpers/release-playwright";
import postgres from "postgres";

import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  acceptanceTestMobiles,
  sellerApplicationDraftTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";
import { establishPlatformAgentSession } from "../helpers/platform-agent-session";

test("applicant keeps a Persian RTL draft across a return and sees the next step after submit", async ({
  page,
}, testInfo) => {
  const mobile = acceptanceTestMobiles[visualProjectIndex(testInfo.project.name)]!;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/seller/login?returnTo=%2Fseller%2Fapplication");
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await page.getByRole("link", { name: "ادامه کار" }).click();
  await expect(page.locator("main")).not.toContainText(
    "در حال آماده‌کردن درخواست شما…",
  );

  const existingWithdrawal = page.getByRole("button", {
    name: "پس‌گرفتن درخواست",
  });
  const startNew = page.getByRole("button", { name: "ثبت درخواست تازه" });
  if (await existingWithdrawal.isVisible()) {
    page.once("dialog", (dialog) => dialog.accept());
    await existingWithdrawal.click();
    await expect(startNew).toBeVisible();
    await startNew.click();
  } else if (await startNew.isVisible()) {
    await startNew.click();
  }

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "درخواست فروشندگی" })).toBeVisible();
  const firstField = page.getByLabel("نام و نام خانوادگی");
  const continueButton = page.getByRole("button", { name: "ادامه" });
  await expect(firstField).toBeFocused();
  await assertNoHorizontalOverflow(page);
  await assertMinimumContrast(continueButton);
  expect(
    Number.parseFloat(
      await firstField.evaluate(
        (element) => getComputedStyle(element).transitionDuration,
      ),
    ),
  ).toBeLessThan(0.001);
  await firstField.fill("نگار محمدی");
  await page.keyboard.press("Tab");
  await expect(continueButton).toBeFocused();
  await expect(continueButton).toHaveCSS("outline-style", "solid");
  await continueButton.click();
  await page.getByLabel("نام پیشنهادی فروشگاه").fill("خانه ماه");

  await page.goto("/");
  await page.goto("/seller/application");
  await expect(page.getByLabel("نام پیشنهادی فروشگاه")).toHaveValue("خانه ماه");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByLabel("چه کالاهایی می‌فروشید؟").fill("سفال دست‌ساز");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page
    .getByLabel("الان چطور می‌فروشید؟")
    .fill("فروش از راه اینستاگرام و پیام مستقیم");
  await page.getByRole("button", { name: "ثبت درخواست" }).click();

  await expect(page.getByText("درخواست شما ثبت شد.")).toBeVisible();
  await expect(
    page.getByText("قدم بعدی: نتیجه بررسی را همین‌جا می‌بینید."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("درخواست شما ثبت شد.")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "پس‌گرفتن درخواست" }).click();
  await expect(page.getByText("این درخواست بسته شده است.")).toBeVisible();
});

test("an information-request draft survives a reload without losing applicant edits", async ({
  page,
}, testInfo) => {
  const mobile =
    sellerApplicationDraftTestMobiles[visualProjectIndex(testInfo.project.name)]!;
  const application = informationRequestApplication();
  await page.route("**/api/seller-applications/mine", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [application], nextCursor: null }),
    }),
  );
  await page.goto("/seller/login?returnTo=%2Fseller%2Fapplication");
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await page.getByRole("link", { name: "ادامه کار" }).click();

  const field = page.getByLabel("الان چطور می‌فروشید؟");
  await expect(field).toHaveValue(application.currentPayload.currentSalesMethod);
  await field.fill("فروش حضوری و ثبت سفارش در پیام‌رسان");
  await page.reload();
  await expect(field).toHaveValue("فروش حضوری و ثبت سفارش در پیام‌رسان");
});

test("an approved application points to the canonical seller workspace", async ({
  page,
}, testInfo) => {
  const mobile =
    sellerApplicationDraftTestMobiles[visualProjectIndex(testInfo.project.name)]!;
  await page.route("**/api/seller-applications/mine", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [approvedApplication()], nextCursor: null }),
    }),
  );
  await page.goto("/seller/login?returnTo=%2Fseller%2Fapplication");
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await page.getByRole("link", { name: "ادامه کار" }).click();
  await expect(page.getByText("درخواست شما تأیید شد.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "رفتن به فضای فروشنده" }),
  ).toHaveAttribute("href", "/seller");
});

test("a rejected application explains the outcome and offers a fresh start", async ({
  context,
  page,
}) => {
  await establishIdentitySession(context);
  await page.route("**/api/seller-applications/mine", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [rejectedApplication()], nextCursor: null }),
    }),
  );
  await page.goto("/seller/application");

  await expect(page.getByText("این درخواست تأیید نشد.")).toBeVisible();
  await expect(
    page.getByText("شرایط فروشندگی برای این درخواست احراز نشد."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "ثبت درخواست تازه" })).toBeVisible();
});

test("applicant and platform agent complete the real seller approval journey", async ({
  context,
  page,
}) => {
  const identityId = await establishIdentitySession(context);
  const proposedStoreName = `خانه پذیرش ${identityId.slice(0, 6)}`;

  await page.goto("/seller/application");
  await page.getByLabel("نام و نام خانوادگی").fill("نگار محمدی");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByLabel("نام پیشنهادی فروشگاه").fill(proposedStoreName);
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByLabel("چه کالاهایی می‌فروشید؟").fill("سفال دست‌ساز");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByLabel("الان چطور می‌فروشید؟").fill("فروش در شبکه‌های اجتماعی");
  await page.getByRole("button", { name: "ثبت درخواست" }).click();
  await expect(
    page.getByText("قدم بعدی: نتیجه بررسی را همین‌جا می‌بینید."),
  ).toBeVisible();

  await page.goto("/seller");
  await expect(page).toHaveURL(/\/seller\/application$/);

  await establishPlatformAgentSession(context, ["SELLER_APPLICATION_REVIEW"]);
  await page.goto("/platform/seller-applications");
  await page.getByRole("button", { name: new RegExp(proposedStoreName) }).click();
  await page
    .getByLabel("دلیل قابل‌نمایش به متقاضی")
    .fill("لطفاً روش فعلی فروش را روشن‌تر توضیح دهید.");
  await page.getByRole("button", { name: "ثبت درخواست تکمیل" }).click();
  await expect(
    page.getByText("قدم بعدی: منتظر تکمیل اطلاعات متقاضی بمانید."),
  ).toBeVisible();

  await page.goto("/seller/application");
  await page
    .getByLabel("الان چطور می‌فروشید؟")
    .fill("فروش از راه اینستاگرام و پیام مستقیم");
  await page.getByRole("button", { name: "ثبت اطلاعات تکمیلی" }).click();
  await expect(page.getByText("درخواست شما ثبت شد.")).toBeVisible();

  await page.goto("/platform/seller-applications");
  await page.getByRole("button", { name: new RegExp(proposedStoreName) }).click();
  await page.getByLabel("تأیید درخواست").check();
  await page
    .getByLabel("دلیل قابل‌نمایش به متقاضی")
    .fill("شرایط فروشندگی شما تأیید شد.");
  await page.getByRole("button", { name: "تأیید و ساخت فروشگاه" }).click();
  await expect(
    page.getByText("درخواست تأیید شد؛ فروشندگی فعال و فروشگاه اولیه ساخته شد."),
  ).toBeVisible();

  await page.goto("/seller/application");
  await expect(page).toHaveURL(/\/seller$/);
  await expect(page.getByRole("heading", { name: "کارهای نزدیک" })).toBeVisible();
});

test("a legacy store draft loads in the existing form and saves with its revision", async ({
  page,
}, testInfo) => {
  const mobile =
    sellerApplicationDraftTestMobiles[visualProjectIndex(testInfo.project.name)]!;
  await page.route("**/api/seller-applications/mine", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [approvedApplication()], nextCursor: null }),
    }),
  );

  let savedRequest: { headers: Record<string, string>; body: unknown } | undefined;
  let savedDraft = legacyStoreDraft();
  await page.route("**/api/store/seller/store/draft", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(legacyStoreDraft()),
      });
      return;
    }
    savedRequest = {
      headers: route.request().headers(),
      body: route.request().postDataJSON(),
    };
    const submitted = savedRequest.body as {
      name: string;
      bio: string;
      returnPolicy: string;
      themeColor: string;
    };
    savedDraft = {
      ...legacyStoreDraft(),
      name: submitted.name,
      bio: submitted.bio,
      returnPolicy: submitted.returnPolicy,
      themeColor: submitted.themeColor,
      shippingMethods: [
        {
          ...legacyStoreDraft().shippingMethods[0],
          revision: 2,
          label: "دریافت حضوری",
        },
      ],
      revision: 8,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(savedDraft),
    });
  });
  await page.route("**/api/store/seller/store/preview", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        store: savedDraft,
        publicationReadiness: { ready: true, missingFields: [] },
      }),
    }),
  );

  await page.goto("/seller/login?returnTo=%2Fseller%2Fstore%2Fsetup");
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  const continueLink = page.getByRole("link", { name: "ادامه کار" });
  await expect(continueLink).toBeVisible();

  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const identities = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId"
      from identity_login_methods
      where mobile = ${mobile}
    `;
    const identityId = identities[0]?.identityId;
    if (!identityId) throw new Error("legacy store identity was not created");
    await sql`
      insert into identity_seller_access (id, identity_id, status)
      values (${crypto.randomUUID()}, ${identityId}, 'ACTIVE')
      on conflict (identity_id) do update set status = 'ACTIVE'
    `;
  } finally {
    await sql.end();
  }
  await continueLink.click();

  await expect(page.getByLabel("نام فروشگاه")).toHaveValue("  ");
  await expect(page.getByLabel("معرفی کوتاه")).toHaveValue(" x");
  await page.getByLabel("نام فروشگاه").fill("فروشگاه اصلاح‌شده");
  await page.getByLabel("معرفی کوتاه").fill("معرفی اصلاح‌شده فروشگاه");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByLabel("سیاست مرجوعی").fill("قانون اصلاح‌شده مرجوعی فروشگاه");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" }).click();

  await expect(page.getByRole("heading", { name: "پیش‌نمایش فروشگاه" })).toBeVisible();
  expect(savedRequest?.headers["if-match"]).toBe('"7"');
  expect(savedRequest?.body).toMatchObject({
    name: "فروشگاه اصلاح‌شده",
    bio: "معرفی اصلاح‌شده فروشگاه",
    returnPolicy: "قانون اصلاح‌شده مرجوعی فروشگاه",
  });
});

function informationRequestApplication() {
  const submittedAt = "2026-08-24T08:00:00.000Z";
  return {
    applicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
    status: "NEEDS_INFORMATION",
    currentRevision: 1,
    currentPayload: {
      applicantName: "نگار محمدی",
      proposedStoreName: "خانه ماه",
      goodsAreaText: "سفال دست‌ساز",
      currentSalesMethod: "فروش از راه اینستاگرام",
    },
    nextStep: "PROVIDE_INFORMATION",
    createdAt: submittedAt,
    lastSubmittedAt: submittedAt,
    timeline: [
      {
        revision: 1,
        status: "SUBMITTED",
        title: "درخواست ثبت شد",
        publicReason: null,
        reasonCode: null,
        requestedFields: [],
        occurredAt: submittedAt,
      },
      {
        revision: 1,
        status: "NEEDS_INFORMATION",
        title: "اطلاعات بیشتری لازم است",
        publicReason: "لطفاً روش فعلی فروش را روشن‌تر بنویسید.",
        reasonCode: "INFORMATION_INCOMPLETE",
        requestedFields: ["currentSalesMethod"],
        occurredAt: "2026-08-24T09:00:00.000Z",
      },
    ],
  } as const;
}

function approvedApplication() {
  const submittedAt = "2026-08-24T08:00:00.000Z";
  return {
    applicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
    status: "APPROVED",
    currentRevision: 1,
    currentPayload: {
      applicantName: "نگار محمدی",
      proposedStoreName: "خانه ماه",
      goodsAreaText: "سفال دست‌ساز",
      currentSalesMethod: "فروش از راه اینستاگرام",
    },
    nextStep: "START_SELLER_WORKSPACE",
    createdAt: submittedAt,
    lastSubmittedAt: submittedAt,
    timeline: [
      {
        revision: 1,
        status: "SUBMITTED",
        title: "درخواست ثبت شد",
        publicReason: null,
        reasonCode: null,
        requestedFields: [],
        occurredAt: submittedAt,
      },
      {
        revision: 2,
        status: "APPROVED",
        title: "درخواست تأیید شد",
        publicReason: "شرایط فروشندگی شما تأیید شد.",
        reasonCode: "ELIGIBILITY_CONFIRMED",
        requestedFields: [],
        occurredAt: "2026-08-24T09:00:00.000Z",
      },
    ],
  } as const;
}

function rejectedApplication() {
  const application = approvedApplication();
  return {
    ...application,
    status: "REJECTED",
    nextStep: "APPLICATION_ENDED",
    timeline: [
      application.timeline[0],
      {
        revision: 2,
        status: "REJECTED",
        title: "درخواست تأیید نشد",
        publicReason: "شرایط فروشندگی برای این درخواست احراز نشد.",
        reasonCode: "ELIGIBILITY_NOT_ESTABLISHED",
        requestedFields: [],
        occurredAt: "2026-08-24T09:00:00.000Z",
      },
    ],
  } as const;
}

function legacyStoreDraft() {
  return {
    id: "5e652775-b807-4fb6-956e-62418495e424",
    sellerId: "39d6f0e1-35c5-4192-8147-1b45570e6a1d",
    name: "  ",
    slug: "legacy-readable-store",
    bio: " x",
    shippingMethods: [
      {
        id: "1dbaf795-cb08-49bd-b9d5-c71c3c708ed9",
        revision: 1,
        code: "PICKUP",
        label: "  ",
        fixedFee: { amount: 0, currency: "IRR" },
        estimatedDeliveryText: "زمان دقیق تحویل هنگام ثبت سفارش مشخص می‌شود.",
        enabled: true,
        requiresDeliveryAddress: false,
        requiresPostalCode: false,
      },
    ],
    returnPolicy: "          ",
    returnPolicyRevision: 1,
    settlementDestination: { kind: "TEST", status: "TEST_VERIFIED" },
    logoMediaId: null,
    coverMediaId: null,
    themeColor: "#A41439",
    status: "DRAFT",
    publicationVersion: 0,
    revision: 7,
    updatedAt: "2026-08-28T10:00:00.000Z",
  };
}

async function establishIdentitySession(context: BrowserContext) {
  const identityId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.begin(async (transaction) => {
      await transaction`
        insert into identity_identities (id, status)
        values (${identityId}, 'ACTIVE')
      `;
      await transaction`
        insert into identity_sessions
          (id, token_hash, identity_id, audience, expires_at)
        values
          (${randomUUID()}, ${createHash("sha256").update(token).digest("hex")},
           ${identityId}, 'PUBLIC', now() + interval '1 hour')
      `;
    });
    await context.addCookies([
      {
        name: "sevo_session",
        value: token,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    return identityId;
  } finally {
    await sql.end();
  }
}
