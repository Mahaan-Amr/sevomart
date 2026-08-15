# خط پایه توسعه

این راهنما خروجی مسئلهٔ [آماده‌سازی خط پایه توسعه، تست و CI](https://github.com/Mahaan-Amr/sevomart/issues/18)
است. هدف آن فراهم‌کردن یک نقطه شروع مشترک برای دو مسیر مستقل خریدار و فروشنده است.

## پیش‌نیاز و شروع

- Node.js `22.13+`، Corepack و Docker Desktop؛
- Chrome محلی برای E2E توسعه؛ CI از Chromium ایزوله Playwright استفاده می‌کند؛
- اجرای `corepack enable` و سپس `pnpm install`؛
- اجرای `pnpm dev` برای بالا آوردن PostgreSQL، ساخت بسته‌های مشترک و اجرای هم‌زمان web، API و worker؛
- web در `http://localhost:3000`، API در `http://localhost:3001` و OpenAPI در
  `http://localhost:3001/openapi` است.

مقادیر محلی امن در `.env.example` ثبت شده‌اند. secret واقعی فقط در محیط اجرا نگهداری
می‌شود و فایل `.env` وارد Git نیست. `pnpm db:down` سرویس محلی را متوقف می‌کند و volume
داده را حذف نمی‌کند.

## فرمان‌های کیفیت

| فرمان | مرز بررسی |
|---|---|
| `pnpm format:check` | قالب فایل‌ها |
| `pnpm lint` | ESLint و جهت importهای معماری |
| `pnpm typecheck` | TypeScript strict و Prisma schema |
| `pnpm test:unit` | قراردادهای کوچک بدون I/O |
| `pnpm test:contract` | fake آداپترها و compatibility قرارداد |
| `pnpm test:integration` | API و سپس هر ماژول روی PostgreSQL واقعی |
| `pnpm test:e2e` | مسیر موبایل و RTL در Chromium |
| `pnpm quality` | کنترل سریع پیش از commit |
| `pnpm test` | همه سطح‌های آزمون |

CI همین فرمان‌ها را با نصب قفل‌شده و PostgreSQL واقعی اجرا می‌کند. imageهای web، API و
worker از Dockerfileهای مستقل ولی با context ریشه ساخته می‌شوند.

## افزودن ماژول

1. نام مصوب ADR-002 را از `docs/architecture/module-ownership.json` انتخاب کنید.
2. مالکیت interface، جدول و migration را در Issue اعلام کنید.
3. `node scripts/create-module.mjs <module-name>` را اجرا کنید.
4. فقط contractهای هم‌زمان پایدار را از `public.ts` export کنید. import implementation
   ماژول دیگر با `pnpm check:architecture` رد می‌شود.
5. migration را با قالب `YYYYMMDDHHMMSS__<module>__<change>` بسازید و برنامه forward-fix
   یا rollback را در PR بنویسید.
6. رفتار را از interface عمومی با integration test روی PostgreSQL واقعی بیازمایید.

## قرارداد و fake

`@sevo/contracts` فقط قراردادهای واقعاً مشترک مانند پاسخ سلامت و قالب خطا را دارد؛
مدل دامنه مشترک در آن قرار نمی‌گیرد. نمونه `ObjectStoragePort` داخل ماژول رسانه مالکیت
قرارداد را نشان می‌دهد و `FakeObjectStorage` همان contract suite را اجرا می‌کند. adapter
واقعی S3 نیز باید همان suite را پاس کند؛ تست دامنه هرگز به provider واقعی متصل نمی‌شود.

افزودن فیلد اختیاری سازگار است. تغییر ناسازگار با افزودن نسخه جدید، مهاجرت مصرف‌کنندگان
و سپس حذف نسخه قدیمی انجام می‌شود. OpenAPI مرجع قرارداد REST برای web است.

## محیط و مشاهده‌پذیری

Fastify لاگ JSON و `x-correlation-id` تولید یا عبور می‌دهد. اگر
`OTEL_EXPORTER_OTLP_ENDPOINT` تنظیم شود، API و worker traceهای OpenTelemetry را به collector
می‌فرستند؛ خالی‌بودن آن در توسعه محلی معتبر است. هیچ داده حساس یا payload کاربر نباید در
log، trace، fixture یا Issue ثبت شود.
