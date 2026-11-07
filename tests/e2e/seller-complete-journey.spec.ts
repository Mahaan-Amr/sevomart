import { expect, test } from "../helpers/release-playwright";
import { establishPlatformAgentSession } from "../helpers/platform-agent-session";
import {
  completeSellerJourneyTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";
import sharp from "sharp";

test("a seller completes the application, setup and first product journey", async ({
  page,
  newCandidateContext,
}, testInfo) => {
  test.setTimeout(180_000);
  const index = visualProjectIndex(testInfo.project.name) + testInfo.retry * 4;
  const mobile = completeSellerJourneyTestMobiles[index]!;
  const suffix = `${index}-${Date.now()}`;
  const storeName = `خانه آزمون ${suffix}`;
  const slug = `journey-${suffix}`;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/seller/start");
  await page.getByRole("button", { name: /مرحله 3:/ }).click();
  await page.getByRole("link", { name: "شروع درخواست فروشندگی" }).click();
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/seller\/application$/);
  await page.getByLabel("نام و نام خانوادگی").fill("نگار محمدی");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByLabel("نام پیشنهادی فروشگاه").fill(storeName);
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByLabel("چه کالاهایی می‌فروشید؟").fill("سفال دست‌ساز");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByLabel("الان چطور می‌فروشید؟").fill("فروش در شبکه‌های اجتماعی");
  await page.getByRole("button", { name: "ثبت درخواست" }).click();
  await expect(page.getByText("درخواست شما ثبت شد.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("درخواست شما ثبت شد.")).toBeVisible();
  const contextOptions = {
    viewport: testInfo.project.use.viewport,
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
    reducedMotion: "reduce" as const,
  };
  const agentContext = await newCandidateContext(contextOptions);
  await establishPlatformAgentSession(agentContext, ["SELLER_APPLICATION_REVIEW"]);
  const agent = await agentContext.newPage();
  await agent.goto("/platform/seller-applications");
  await agent.getByRole("button", { name: new RegExp(storeName) }).click();
  await agent.getByLabel("تأیید درخواست").check();
  await agent.getByRole("button", { name: "تأیید و ساخت فروشگاه" }).click();
  await expect(
    agent.getByText("درخواست تأیید شد؛ فروشندگی فعال و فروشگاه اولیه ساخته شد."),
  ).toBeVisible();
  await agentContext.close();
  await page.goto("/seller/application");
  await expect(page).toHaveURL(/\/seller$/);
  await expect(page.getByRole("heading", { name: "کارهای نزدیک" })).toBeVisible();
  const sellerContext = await newCandidateContext(contextOptions);
  const seller = await sellerContext.newPage();
  await seller.goto("/seller/login?returnTo=%2Fseller");
  await seller.getByLabel("شماره موبایل").fill(mobile);
  await seller.getByRole("button", { name: "دریافت کد" }).click();
  await seller.getByLabel("کد شش‌رقمی").fill("111111");
  await seller.getByRole("button", { name: "ورود" }).click();
  await seller.getByRole("link", { name: "ادامه کار" }).click();
  await expect(
    seller.getByRole("heading", { name: "فروشگاه را منتشر کنید" }),
  ).toBeVisible();
  await seller.getByRole("link", { name: "ادامه راه‌اندازی" }).click();
  await seller.getByLabel("نام فروشگاه").fill(storeName);
  await seller.getByRole("button", { name: "ذخیره و خروج" }).click();
  await expect(seller.getByText("پیش‌نویس فروشگاه ذخیره شده است")).toBeVisible();
  await expect(
    seller.getByText("تسویه آزمایشی است؛ فروش و پرداخت واقعی فعال نیست."),
  ).toBeVisible();
  await seller.getByRole("link", { name: "ادامه راه‌اندازی" }).click();
  await expect(seller.getByLabel("نام فروشگاه")).toHaveValue(storeName);
  await seller.getByRole("button", { name: "ادامه" }).click();
  await expect(
    seller.getByText("شناسه لینک باید دست‌کم سه نویسه و با قالب نمونه باشد."),
  ).toBeVisible();
  await expect(seller).toHaveURL(/\/seller\/store\/setup/);
  await seller.getByLabel("شناسه لینک").fill(slug);
  await seller.getByLabel("معرفی کوتاه").fill("کالاهای سفالی دست‌ساز برای خانه");
  await seller.getByRole("button", { name: "ادامه" }).click();
  await seller.getByRole("combobox").selectOption("NATIONAL_POST");
  await seller.getByLabel("هزینه ارسال (تومان)").fill("۰");
  await seller
    .getByLabel("سیاست مرجوعی")
    .fill("تا هفت روز پس از تحویل می‌توانید درخواست مرجوعی ثبت کنید.");
  await seller.getByRole("button", { name: "ادامه" }).click();
  await seller.getByRole("button", { name: "ذخیره و دیدن پیش‌نمایش" }).click();
  await expect(
    seller.getByRole("heading", { name: "پیش‌نمایش فروشگاه" }),
  ).toBeVisible();
  await expect(
    seller.getByText("فروش و پرداخت واقعی با این تأیید فعال نیست."),
  ).toBeVisible();
  await seller.getByRole("button", { name: "انتشار فروشگاه" }).click();
  await expect(
    seller.getByRole("heading", { name: "فروشگاه آماده است" }),
  ).toBeVisible();
  await seller.goto("/seller");
  await expect(
    seller.getByRole("heading", { name: "اولین کالا را اضافه کنید" }),
  ).toBeVisible();
  await seller.getByRole("link", { name: "افزودن کالا" }).click();
  await seller.getByLabel("نام کالا").fill("گلدان سفالی");
  await seller
    .getByLabel("توضیح کالا")
    .fill("گلدان سفالی دست‌ساز برای میز و فضای کوچک");
  await seller.getByRole("button", { name: "ادامه" }).click();
  const image = await sharp({
    create: { width: 900, height: 900, channels: 4, background: "#A41439" },
  })
    .png()
    .toBuffer();
  await seller
    .getByLabel("انتخاب تصویر کالا")
    .setInputFiles({ name: "vase.png", mimeType: "image/png", buffer: image });
  await seller.getByRole("button", { name: "ادامه" }).click();
  await seller.getByLabel("قیمت گونه اصلی").fill("325000");
  await seller.getByLabel("موجودی گونه اصلی").fill("7");
  await seller.getByRole("button", { name: "دیدن پیش‌نمایش" }).click();
  await seller.getByRole("button", { name: "انتشار کالا" }).click();
  const publicLink = seller.getByRole("link", { name: "دیدن کالا در فروشگاه" });
  await expect(publicLink).toBeVisible();
  const href = await publicLink.getAttribute("href");
  if (!href) throw new Error("Missing public product link");
  const guestContext = await newCandidateContext(contextOptions);
  const guest = await guestContext.newPage();
  await guest.goto(href);
  await expect(guest.getByRole("heading", { name: "گلدان سفالی" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "افزودن به سبد" })).toBeEnabled();
  await guestContext.close();
  await seller.goto("/seller");
  await seller.getByRole("button", { name: "دیدن راهنمای آغاز" }).click();
  await expect(
    seller.getByRole("heading", { name: "راه‌اندازی کامل شد" }),
  ).toBeVisible();
  await sellerContext.close();
});
