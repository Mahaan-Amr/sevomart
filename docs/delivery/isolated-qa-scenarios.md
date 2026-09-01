# factory سناریوهای QA ایزوله

این تحویل، قرارداد [ایجاد factory سناریوهای QA ایزوله](https://github.com/Mahaan-Amr/sevomart/issues/162)
را روی lifecycle امن و disposable موجود کامل می‌کند. هدف آن ساختن دقیقاً داده لازم هر
سناریو است؛ نه کپی‌کردن baseline داده نمایشی و نه پاک‌سازی یک پایگاه مشترک.

## interface نسخه یک

interface عمومی `withQaScenario` در `scripts/qa/scenario.v1.mjs` است و شکل ماشین‌خوان
قرارداد در `ops/qa/scenario-contract.v1.json` نگه‌داری می‌شود. هر فراخوانی:

1. از نام سناریو و entropy محلی، `runId` یکتای حداکثر ۳۱ نویسه و namespace با پیشوند
   `sevo.qa.` می‌سازد؛
2. PostgreSQL و MinIO تازه را با profile صریح `qa` و migration ledger مشترک بالا می‌آورد؛
3. context نسخه‌دار شامل ساعت UTC ثابت، شناسه‌ساز UUID v5 وابسته به namespace، endpointها و
   `scenario.environment` کامل همان اجرای disposable را به `build` می‌دهد؛
4. فقط داده‌ای را می‌سازد که callback همان سناریو درخواست کرده است؛
5. `exercise` را اجرا و در موفقیت یا شکست، teardown را فقط با جفت `runId + fingerprint`
   همان محیط انجام می‌دهد.

نمونه استفاده در تست:

```ts
await withQaScenario(
  {
    name: "payment-refused",
    fixedTime: "2026-08-30T08:30:00.000Z",
    async build(scenario) {
      const orderId = scenario.id("order");
      // فقط commandهای لازم همین سفارش را با scenario.clock.now() اجرا کنید.
      return { orderId };
    },
  },
  async (scenario) => {
    // رفتار عمومی را با scenario.data.orderId بیازمایید.
  },
);
```

نام‌های ورودی lowercase و پایدارند، `fixedTime` باید timestamp کامل UTC باشد و نام‌های داده
برای `scenario.id()` نیز کلید پایدار lowercase هستند. مقدار برگشتی `build` تنها داده قابل
مشاهده `exercise` است؛ بنابراین داده جانبی یا setup عمومی پنهان وارد سناریو نمی‌شود.

## ایمنی محیط و teardown

- adapter هیچ `DATABASE_URL` ورودی نمی‌پذیرد، مقدار ارثی shell/CI را حذف می‌کند و مقصد را
  فقط از پورت گزارش‌شده lifecycle همان اجرا می‌سازد.
- runner مستقل `pnpm test:qa-scenario` پیش از ساخت process آزمون، `DATABASE_URL` را حذف و
  `SEVO_RUNTIME_ENV=test` و OTP داخلی `dev` را قطعی می‌کند. خود `withQaScenario` همین env را
  پیش از callbackهای `build` و `exercise` دوباره بررسی می‌کند. هر callback برای composition
  واقعی برنامه باید `scenario.environment` را مصرف کند؛ این مقدار database و MinIO همان
  اجرای disposable، credential محلی ثابت، OTP داخلی و telemetry خاموش را حمل می‌کند و هیچ
  مقصد انسانی یا provider بیرونی process والد را عبور نمی‌دهد.
- lifecycle پیش از write، profile و نام allowlist‌شده پایگاه را از خود مقصد و fingerprint آن
  را بررسی می‌کند. گزارش ناهماهنگ اجرا را متوقف می‌کند و با proof معتبر، teardown
  owner-scoped را پیش از بازگرداندن خطا تلاش می‌کند.
- گزارش startup برای factory روی file descriptor اختصاصی نوشته می‌شود و stdout فقط خروجی
  انسانی است. اگر نوشتن کانال اجباری شکست بخورد، initialization ناموفق می‌شود و coordinator
  موجود پیش از خروج، پروژه و claim همان run را حذف می‌کند؛ خروجی ناقص نمی‌تواند محیط orphan
  و ظاهراً موفق باقی بگذارد.
- اگر هم رفتار سناریو و هم teardown شکست بخورند، هر دو خطا در `AggregateError` حفظ می‌شوند؛
  موفق نشان‌دادن سناریویی که محیطش پاک نشده مجاز نیست.
- factory هیچ import یا receipt از `demo:seed` و manifest داده نمایشی ندارد. حذف محیط QA نیز
  داده یا volume متعلق به local، CI job دیگر یا اجرای QA دیگر را هدف نمی‌گیرد.

## مسیرهای اجرا و اثر قرارداد

local و CI، runner مستقل را روی host اجرا می‌کنند و runner برای هر تست stack تازه را از
`compose.yaml` بالا می‌آورد؛ اجرای factory داخل container برنامه یا اتصال به stack از پیش
موجود پشتیبانی نمی‌شود. lifecycle همان فرمان `prisma migrate deploy` رسمی را در container
PostgreSQL disposable اجرا می‌کند، اما startup، env یا پورت مسیرهای runtime برنامه در
`pnpm dev` و `docker compose up --build` را تغییر نمی‌دهد. تست integration واقعی یک هویت
کمینه با timestamp ثابت می‌سازد، خالی‌بودن receiptهای demo را می‌سنجد و پس از پایان نبود
container، network، volume و ownership claim همان run را بررسی می‌کند. regression دوم نیز
شکست کانال report را ایجاد و cleanup کامل startup ناموفق را ثابت می‌کند.

این تغییر endpoint HTTP، payload برنامه، schema پایگاه یا رفتار runtime خریدار/فروشنده را
عوض نمی‌کند؛ در نتیجه OpenAPI و migration تازه‌ای ندارد. قرارداد افزوده‌شده فقط
`QA scenario v1` است و تغییر ناسازگار آینده باید در فایل و entrypoint نسخه تازه منتشر شود.
