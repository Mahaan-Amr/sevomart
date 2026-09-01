# manifest و harness شواهد release-critical

مرجع اجرا: [[ساخت] ایجاد manifest ماتریس شواهد و harness release-critical](https://github.com/Mahaan-Amr/sevomart/issues/165)
و تصمیم [تثبیت دروازه release-critical و ماتریس شواهد نسخه نمایشی](https://github.com/Mahaan-Amr/sevomart/issues/112).

این تحویل ادعای آمادگی production، اتصال provider واقعی یا SLA تولیدی نمی‌کند. کار آن
این است که ادعای «نسخه کامل نمایشی و آماده اتصال» را به شواهد قابل ممیزی برای SHA دقیق
نامزد محدود کند.

## قرارداد نسخه یک

- `ops/qa/release-evidence-manifest.v1.json` سه فضا، پنج هویت نمایشی، ۲۷ سفر مصوب و
  حالت‌های اجباری و شرطی هر سفر را ثبت می‌کند. هر سلول به browser، viewport، چهار لایه
  آزمون، artifact و سطح بازبینی پیوند دارد.
- `ops/qa/release-evidence-contract.v1.json` سیاست ماشین‌خوان candidate را ثابت می‌کند:
  دو اجرای تازه، صفر retry، ممنوعیت skip و quarantine، خطای قطعی console/page/network،
  بازبین مستقل و نگه‌داری ۳۰روزه.
- `scripts/qa/release-evidence.v1.mjs` plan را تولید و evidence pack تکمیل‌شده را
  fail-closed نهایی می‌کند. fingerprint دو اجرا باید متفاوت باشد؛ هر اجرا باید همان SHA،
  predecessor migration، نسخه seed و health artifactهای API، وب و worker را گزارش کند.
- `playwright.release.config.ts` فقط برای candidate است و برخلاف CI روزمره retry ندارد.
  همه سفرها در چهار viewport Chromium اجرا می‌شوند و smoke واقعی ورود و خرید در WebKit
  موبایل و دسکتاپ نیز افزوده شده است. baseline تازه به‌طور خودکار پذیرفته نمی‌شود.
- `pnpm qa:evidence:e2e` کل زنجیره unit، contract، integration و E2E نامزد را دو بار با
  زیرساخت تازه اجرا می‌کند. receipt هر run، نگاشت سلول‌های manifest به فایل‌های واقعاً
  اجراشده، browserها و viewportها را حمل می‌کند و finalizer ادعای هر observation را فقط
  در صورت حضور همان نگاشت می‌پذیرد. fixture خودکار
  در همه فایل‌های E2E ارجاع‌شده، console error، page error، request شکست‌خورده و تماس شبکه
  بیرونی را ثبت و همان تست را fail می‌کند. runner گزارش JSON را نیز برای skip، retry و
  نتیجه‌ای جز pass بازبینی و receipt پیوندخورده به SHA/migration/seed تولید می‌کند.

## اجرای harness

ابتدا قرارداد و همه مسیرهای تست را بررسی کنید:

```bash
pnpm qa:evidence:validate
```

پس از ثبت health و startup smoke هر دو مسیر رسمی، plan را برای SHA دقیق بسازید:

```bash
pnpm qa:evidence:plan -- \
  --sha <40-character-sha> \
  --migration 20260831150000__platform__track-demo-seed-resources \
  --seed-version 2 \
  --health-api output/health/api.json \
  --health-web output/health/web.json \
  --health-worker output/health/worker.json \
  --startup-docker output/startup/docker.json \
  --startup-native output/startup/native.json \
  --author <github-login> \
  --output output/release-evidence/<sha>/plan.v1.json
```

runner و مرورگر باید برای هر سلول و هر اجرای candidate یک observation بسازند. تنها
`PASSED` پذیرفته است؛ `retryCount` باید صفر باشد، آرایه خطاهای غیرمنتظره console و network
خالی بماند، هر چهار artifact مرجع داشته باشند و reviewer با author متفاوت باشد. خطای عمدی
فقط در خود سناریوی خطا و به‌صورت artifact قابل ردیابی ثبت می‌شود و نباید به‌عنوان خطای
غیرمنتظره پنهان شود.
هر artifact علاوه بر `ref`، digest از نوع SHA-256 و bindingهای `runId`، `cellId`، SHA،
migration، نسخه seed و `retentionUntil` دارد. finalizer فایل را از دیسک می‌خواند و digest
و همه bindingها را دوباره بررسی می‌کند؛ مسیر خالی یا فایل دست‌کاری‌شده قابل تأیید نیست.

پس از تکمیل دو run و افزودن تأیید هر دو توسعه‌دهنده به `approvals`:

```bash
pnpm qa:evidence:finalize -- \
  --input output/release-evidence/<sha>/completed.v1.json \
  --output output/release-evidence/<sha>/approved.v1.json
```

خروجی approved، گزارش‌های تست، screenshotهای منتخب، گزارش دسترس‌پذیری، health، startup
و شواهد شکست احتمالی یک evidence pack هستند و باید تا تاریخ `retentionUntil`، دقیقاً ۳۰
روز پس از ساخت plan، نگه‌داری شوند. baselineهای قطعی تصویری همچنان در مخزن می‌مانند.

## اثر قرارداد و runtime

این تغییر endpoint، OpenAPI، schema پایگاه، migration، متغیر محیطی، پورت یا dependency
تازه ندارد. قرارداد جدید فقط در ریل QA است. خود harness بر runtime محصول اثر ندارد؛ با این
حال plan بدون artifact مستقل `docker compose up --build` و `pnpm dev` نهایی نمی‌شود تا
واگرایی دو مسیر رسمی آشکار بماند.
