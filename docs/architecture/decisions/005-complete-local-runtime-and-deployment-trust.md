# ADR-005: محیط کامل محلی و اعتماد مستقل از حالت JavaScript

- وضعیت: پذیرفته‌شده
- تاریخ: ۱۴۰۵-۰۵-۲۶
- Issue: تصمیم تأییدشدهٔ مالک محصول در جلسهٔ طراحی محیط کامل محلی

## زمینه

اجرای فقط PostgreSQL در Docker باعث شد web و API خارج از topology رسمی بمانند و محیطی که «کامل»
به نظر می‌رسید عملاً ساخت فروشگاه را پشتیبانی نکند. با این حال حذف hot reload بومی سرعت توسعه را کاهش
می‌دهد. همچنین `NODE_ENV=production` برای image بهینه نباید به معنی اعتماد production باشد.

## گزینه‌ها

1. Docker تنها مسیر توسعه؛ بازتولیدپذیر، اما کندتر برای حلقهٔ ویرایش.
2. pnpm بومی تنها مسیر؛ سریع، اما topology کامل و قابل انتقال ندارد.
3. Compose مسیر رسمی کامل و pnpm مسیر سریع پشتیبانی‌شده؛ دو مسیر با یک قرارداد زیرساخت.

## تصمیم

گزینهٔ سوم انتخاب شد. Compose با نام ثابت `sevomart` شامل PostgreSQL، MinIO، migration یک‌باره، API،
worker و web است. API و worker پس از موفقیت migration شروع می‌شوند و خودکار schema را تغییر نمی‌دهند.
`pnpm compose:up` برابر build و انتظار سلامت کل stack است. `pnpm dev` PostgreSQL و MinIO را بالا
می‌آورد، migration deploy را اجرا می‌کند و برنامه‌ها را با hot reload بومی راه می‌اندازد.

`NODE_ENV` فقط حالت اجرای JavaScript و `SEVO_RUNTIME_ENV` سطح اعتماد است. Compose محلی imageهای
بهینه با `NODE_ENV=production` و `SEVO_RUNTIME_ENV=development` دارد. تمام guardهای امنیتی از
`SEVO_RUNTIME_ENV` استفاده می‌کنند. production، OTP خارجی، secretهای غیرپیش‌فرض و object storage
پایدار می‌خواهد و مقدارهای محلی شناخته‌شده را رد می‌کند.

پورت‌های container ثابت و پیش‌فرض میزبان قابل override هستند: web `3100→3000`، API `3101→3001`،
PostgreSQL `127.0.0.1:6432→5432`، MinIO API `127.0.0.1:9100→9000` و console
`127.0.0.1:9101→9001`. توقف عادی volumeها را حذف نمی‌کند. فقط فرمان صریح `pnpm local:reset` پس از
نمایش نام دقیق volumeها و تأیید، دادهٔ PostgreSQL و MinIO را پاک می‌کند.

## پیامدها

- onboarding کامل یک فرمان دارد و hot reload همچنان سریع می‌ماند.
- تست‌ها از database و volume جدا و disposable استفاده می‌کنند.
- health شامل liveness و readiness واقعی dependencyهاست؛ موفقیت process به‌تنهایی سلامت نیست.
- Dockerfileهای چندمرحله‌ای، lockfile frozen، کاربر non-root، init کوچک و artifact حداقلی دارند.

## بازنگری

اگر زمان build یا startup از بودجهٔ تیم عبور کند، topology production انتخاب‌شده با این مدل ناسازگار
باشد یا دو مسیر محلی به‌طور مکرر رفتار متفاوت نشان دهند، تصمیم باز می‌شود.
