# مشخصات محیط کامل محلی و رسانهٔ فروشگاه

## خروجی مورد انتظار

- `pnpm compose:up` از checkout تمیز، PostgreSQL، MinIO، migration، API، worker و web سالم می‌سازد.
- `pnpm dev` همان زیرساخت و migration را با hot reload بومی مصرف می‌کند.
- وب و API در Compose محلی با `SEVO_RUNTIME_ENV=development` اجرا می‌شوند تا پرداخت آزمایشی در دسترس باشد؛ این پرداخت پول واقعی جابه‌جا نمی‌کند.
- `pnpm test:checkout-runtime` یک build یکسان وب را با دو محیط توسعه و production اجرا می‌کند و فعال‌بودن پرداخت آزمایشی را در مرورگر برای هر دو بررسی می‌کند؛ Chromium باید نصب باشد.
- ساخت فروشگاه با نشان یا جلد معتبر بین بیش از سقف قدیمی ۱ MiB و حداکثر ۱۰ MB موفق است.
- اصل تصویر byte-for-byte حفظ و variantهای مصوب تولید می‌شوند.
- پیش‌نویس فقط برای مالک و مشتق فروشگاه منتشرشده بدون نشست از API خواندنی است؛ اصل هرگز عمومی نیست.
- stop و rebuild داده را حفظ و فقط reset صریح volumeهای دقیق پروژه را حذف می‌کند.

## معیارهای پذیرش

- خطاهای حجم، ۲۴ مگاپیکسل، animation، خرابی و MIME mismatch پیام فارسی مشخص دارند.
- ثابت‌های browser، API، OpenAPI و تست یکسان‌اند و upload برای هر فروشنده rate limit دارد.
- migration تکرارپذیر است و شکست آن مانع شروع app می‌شود.
- port override، health/readiness و guardهای `SEVO_RUNTIME_ENV=production` آزموده می‌شوند.
- imageها چندمرحله‌ای، frozen، non-root و قابل tag با SHA/release هستند.
- تست unit، contract، integration و E2E، quality، Docker build و Visual QA مسیر فروشنده سبز است.
