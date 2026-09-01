# فهرست و پیگیری سفارش خریدار

مرجع اجرا: [[ساخت] ساخت فهرست و پیگیری سفارش خریدار](https://github.com/Mahaan-Amr/sevomart/issues/148)

مبنای اجرا `ea7bfb802f1004b04f4ff6bcac7ebc30481acb7a` و predecessor migration سفارش
`20260831140200__orders__cancellation-statuses` است. این برش migration، dependency،
متغیر محیطی، پورت یا startup تازه‌ای ندارد.

## نتیجه و قرارداد

- `GET /v1/orders` خلاصه کم‌حساس سفارش‌های همان هویت را برمی‌گرداند؛ نام گیرنده،
  موبایل و نشانی در فهرست نیست.
- `GET /v1/orders/{orderId}` snapshot تغییرناپذیر کالا، فروشگاه، مبلغ، تسویه مستقیم،
  روش ارسال، سیاست مرجوعی و timeline ممیزی‌شده سفارش را فقط برای همان خریدار
  برمی‌گرداند.
- `GET /v1/orders/{orderId}/fulfillment` producer موجود خط زمانی آماده‌سازی، ارسال،
  کد رهگیری و تحویل را می‌دهد.
- `GET /v1/orders/{orderId}/direct-refund` وضعیت واقعی بازپرداخت ثبت‌شده را از مالک
  payments و `GET /v1/buyer/disputes` پرونده‌های همان خریدار را از مالک
  problem-follow-up می‌دهد. هیچ مصرف‌کننده‌ای جدول producer دیگر را مستقیم نمی‌خواند.
- همه readهای حساس `Cache-Control: no-store` دارند. شناسه نامعتبر، سفارش هویت دیگر
  و سفارش ناموجود با پاسخ انسانی و غیرقابل تفکیک ۴۰۴ برمی‌گردند.
- مسیر قدیمی `/orders/{orderId}?attemptId=…` به نتیجه canonical هدایت می‌شود. refresh
  جزئیات و نتیجه فقط read انجام می‌دهد و تلاش پرداخت تازه نمی‌سازد.

## رابط و دسترس‌پذیری

مسیرهای `/orders` و `/orders/{orderId}` فارسی و RTL هستند. صفحه جزئیات یک وضعیت
اصلی و قدم بعدی روشن دارد و snapshot، سیاست مرجوعی، تسویه مستقیم، رهگیری، اختلاف
و بازپرداخت را با آشکارسازی تدریجی زیر همان کار اصلی نشان می‌دهد. مقصد سفارش‌ها پس
از تکمیل سفر در پوسته خریدار فعال شد.

آزمون E2E در چهار اندازه رسمی `360×800`، `390×844`، `768×1024` و `1440×900`
RTL، متن بلند فارسی، نبود overflow، کنتراست، focus صفحه‌کلید، targetهای موجود،
`prefers-reduced-motion`، refresh idempotent و منع مشاهده سفارش هویت دیگر را بررسی
می‌کند. تصاویر QA در `docs/delivery/issue-148/` نگهداری می‌شوند.

## راستی‌آزمایی

- unit: presentation وضعیت/قدم بعدی و binding هویت برای سفارش، اختلاف و بازپرداخت؛
- contract/OpenAPI: operationها، snapshot، summary بدون PII و drift مسیرها؛
- integration با PostgreSQL: list/detail مالک، منع هویت دیگر، snapshot ثبت‌شده و
  پاسخ‌های HTTP احرازشده و `no-store`؛
- E2E: پرداخت موفق، callback تکراری، هدایت legacy، رسید canonical، فهرست، جزئیات،
  refresh بدون تلاش دوم و QA چهار viewport.

مسیر native و Docker هر دو همان build، migration history و متغیرهای موجود را مصرف
می‌کنند؛ چون قرارداد runtime یا راه‌اندازی تازه‌ای اضافه نشده، رفتار startup تغییر
نکرده است.
