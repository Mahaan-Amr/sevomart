# رسانه تجربه خرید خریدار

مرجع: [[ساخت] افزودن رسانه خریدار به تجربه خرید](https://github.com/Mahaan-Amr/sevomart/issues/229)

## قرارداد و مالکیت

- purpose داخلی و مستقل `PURCHASE_EXPERIENCE_IMAGE` است و route عمومی فروشنده یا
  `PRODUCT_IMAGE` آن را نمی‌پذیرد.
- Content پس از تأیید eligibility همان `buyerId/orderItemId` یک upload context با
  عمر ۳۰ دقیقه می‌سازد. پاسخ عمومی فقط `contextId`، مهلت، محدودیت‌ها و `uploadUrl`
  را دارد و `orderItemId` را برنمی‌گرداند.
- Media مالک هویت، ارتباط خصوصی context با قلم سفارش، checksum، اندازه، purpose،
  visibility و کلیدهای retry را نگه می‌دارد. ارتباط قلم سفارش در پاسخ Media، URL
  تصویر یا رخداد عمومی Content ظاهر نمی‌شود.
- upload از مسیر `POST /v1/purchase-experience-media/{contextId}` فقط یک فایل JPEG،
  PNG یا WebP غیرمتحرک تا ۱۰ مگابایت و ۲۴ مگاپیکسل می‌پذیرد. هر خرید حداکثر چهار
  تصویر دارد.

## lifecycle، retry و انتشار

- تصویر و مشتق `attachment-preview` در object storage خصوصی می‌مانند. تا پیش از
  انتشار تجربه، فقط هویت مالک پاسخ preview با `private, no-store` می‌گیرد.
- `Idempotency-Key` در upload الزامی است. retry همان فایل همان `mediaId` را
  برمی‌گرداند؛ استفاده همان کلید برای فایل دیگر با `409` رد می‌شود و شمار تصویر را
  افزایش نمی‌دهد.
- Content پیش از write نهایی، purpose، مالک، context همان `orderItemId` و سقف تعداد
  را از seam عمومی Media دوباره بررسی می‌کند. پس از ثبت تجربه با moderation
  `PUBLISHED`، تصمیم عمومی‌بودن همچنان متعلق به Content است؛ شناسه قلم سفارش در
  پاسخ یا event عمومی منتشر نمی‌شود.
- proxy وب و helper بارگذاری، کلید retry را ثابت نگه می‌دارند و پیام خطای فارسی
  قابل نمایش کنار کنترل RTL می‌دهند. فعال‌کردن خود کنترل در فرم وابسته به Issue 156
  باقی می‌ماند تا Media ناقص وارد ناوبری عمومی نشود.

## migration و اجرا

Migration `20260901123000__media__purchase-experience-images` طول purpose را به ۳۲
افزایش می‌دهد و context و idempotency را در جدول‌های مالک Media نگه می‌دارد. متغیر
محیطی، پورت، dependency یا startup تازه‌ای ندارد؛ بنابراین مسیرهای Docker Compose و
`pnpm dev` همان runtime مشترک را اجرا می‌کنند.
