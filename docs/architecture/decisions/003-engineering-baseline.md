# ADR-003: خط پایه توسعه، تست و CI

- وضعیت: پذیرفته‌شده
- تاریخ: ۱۴۰۵-۰۵-۲۴
- Issue: [آماده‌سازی خط پایه توسعه، تست و CI](https://github.com/Mahaan-Amr/sevomart/issues/18)
- تکمیل زیرساخت رخداد: [outbox پایدار و Worker قابل‌بازیابی](https://github.com/Mahaan-Amr/sevomart/issues/76)

## زمینه

دو مسیر خریدار و فروشنده باید روی پشته ADR-001 و مرزهای ADR-002 بدون تکرار scaffold،
قرارداد یا تصمیم عملیاتی شروع شوند. baseline باید کوچک، قابل اجرای محلی و قابل کنترل در CI
باشد و secret یا وابستگی runtime خارجی وارد توسعه نکند.

## گزینه‌ها

1. scaffold مستقل برای هر مسیر؛ شروع سریع هر شاخه، با قرارداد و تنظیمات تکراری و برخورد ادغام.
2. monorepo با orchestrator و سرویس‌های توسعه متعدد؛ cache بهتر، با ابزار و نگهداری بیشتر.
3. pnpm workspace با فرمان‌های native و بسته‌های مشترک محدود؛ orchestration کمتر، ولی کافی برای تیم دو نفره.

## تصمیم

گزینه سوم انتخاب شد. workspace شامل `web`، `api` و `worker` و بسته‌های محدود قرارداد،
پیکربندی، مشاهده‌پذیری، database و `outbox` است. بستهٔ `outbox` فقط enqueue تراکنشی، اجاره،
backoff و رسید idempotent مبتنی بر PostgreSQL را فراهم می‌کند و قاعده یا قرارداد دامنه‌ای ندارد؛
وابستگی runtime خارجی تازه‌ای نیز اضافه نمی‌کند. `pnpm dev` PostgreSQL محلی را بالا می‌آورد و سه process
را اجرا می‌کند. TypeScript strict، ESLint، Prettier، Vitest، Playwright و Prisma validate در
CI اجرا می‌شوند.

دلیل، نگهداری، مجوز و اثر امنیتی dependencyهای این baseline در
[دفتر وابستگی‌ها](../dependency-register.md) ثبت می‌شود.

قرارداد REST نسخه‌دار و OpenAPI است. architecture check فقط import از `public.ts` ماژول
دیگر را می‌پذیرد و دو route group خریدار و فروشنده را مستقل نگه می‌دارد. migration نام مالک
ماژول را دارد. fake آداپتر خارجی باید همان contract suite آداپتر واقعی را پاس کند.

محیط نمونه فقط مقدار محلی دارد. API لاگ JSON و correlation ID دارد و OpenTelemetry تنها با
endpoint صریح فعال می‌شود. runtime تولید در سه Docker image قابل‌انتقال باقی می‌ماند.

## پیامدها

- هر دو مسیر یک نصب، فرمان کیفیت و contract مشترک دارند و می‌توانند پوشه‌های مستقل را تغییر دهند.
- pnpm native برای مقیاس فعلی کافی است؛ در صورت کندشدن قابل‌اندازه‌گیری CI می‌توان cache
  orchestrator را افزود.
- integration هر ماژول با اضافه‌شدن schema باید PostgreSQL واقعی را مصرف کند؛ SQLite و mock
  database جایگزین آن نیست.
- PWA فعلی installability و RTL را scaffold می‌کند؛ قابلیت‌های محصول فقط از Issue ساخت افزوده می‌شوند.

## بازنگری

اگر زمان CI یا startup محلی از بودجه مصوب عبور کند، topology استقرار تغییر کند، contractهای
بیشتری به code generation نیاز داشته باشند یا دو مسیر دائماً فایل مشترک را تغییر دهند، این
تصمیم باز می‌شود.
