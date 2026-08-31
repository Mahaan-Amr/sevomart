# لغو و بازپرداخت تسویه مستقیم

مرجع اجرا: [تکمیل لغو و بازپرداخت تسویه مستقیم](https://github.com/Mahaan-Amr/sevomart/issues/135).
مبنای اجرا `b5a4fa68657f4d61897ab186e3a859ee9df92cef` و predecessor migration برابر
`20260831130000__reporting-analytics__seller-operations` است.

## نتیجه

- فروشنده فعال فقط پیش از `SHIPPED` می‌تواند لغو را آغاز کند. سفارش و timeline
  انجام سفارش به `CANCELLATION_PENDING_REFUND` می‌روند و تا ثبت نتیجه تأییدشده
  لغوشده محسوب نمی‌شوند.
- نتیجه امضاشده provider پس از تطبیق شناسه تلاش و مبلغ پذیرفته می‌شود. نتیجه
  ناموفق همراه `evidenceReference` در تاریخچه تغییرناپذیر پرداخت ثبت می‌شود،
  سفارش را در انتظار نگه می‌دارد و قدم بعدی `RETRY_REFUND` است. retry با کلید و
  hash درخواست idempotent است و replay اثر یا audit دوم نمی‌سازد.
- نتیجه تأییدشده در یک transaction، سابقه پرداخت را `CONFIRMED`، سفارش و timeline
  را `CANCELLED` و رزرو مصرف‌شده را `CANCELLED` می‌کند. مقدار اقلام دقیقاً یک‌بار
  به موجودی برمی‌گردد و adjustment ممیزی‌شده دارد.
- فروشنده نمی‌تواند نتیجه `CONFIRMED` را خودش ثبت کند؛ callback خام ابتدا در
  adapter provider verify می‌شود. پاسخ و رخدادها دلیل داخلی و شناسه مدرک را منتشر
  نمی‌کنند. متن API فقط ثبت و
  پیگیری نتیجه را بیان می‌کند و هیچ تضمین بازپرداختی نمی‌دهد.

## قرارداد و داده

دو route فروشنده و یک route نتیجه provider در `@sevo/contracts/payments/v1` و
OpenAPI ثبت شده‌اند:

- `POST /v1/seller/orders/{orderId}/direct-refund`
- `GET /v1/seller/orders/{orderId}/direct-refund`
- `POST /internal/v1/payment-providers/{provider}/direct-refunds`

دو route فروشنده نشست هویت، فروشندگی فعال و مالکیت همان فروشگاه می‌خواهند؛ write
فروشنده و callback provider هر دو `Idempotency-Key` دارند و همه پاسخ‌ها
`Cache-Control: no-store` هستند. callback امضاشده است و payment attempt و مبلغ را
با رکورد authoritative تطبیق می‌دهد. قراردادهای orders و fulfillment فقط وضعیت‌ها
و رخدادهای نسخه‌دار افزودنی گرفته‌اند. payment مالک سابقه و مدرک، order مالک وضعیت
سفارش، fulfillment مالک timeline و inventory مالک بازگرداندن ممیزی‌شده موجودی است؛
هیچ producer جدول producer دیگر را مستقیم تغییر نمی‌دهد.

migrationهای forward-only این برش عبارت‌اند از:

- `20260831140000__payments__direct-refund-history`
- `20260831140100__fulfillment__cancellation-statuses`
- `20260831140200__orders__cancellation-statuses`
- `20260831140300__inventory__cancelled-order-restock`
- `20260831140400__reporting-analytics__cancellation-statuses`

dependency، env، secret، پورت یا startup تازه‌ای اضافه نشده است. صفحه مستقل فروشنده
برای آغاز لغو و دیدن وضعیت، فارسی و RTL است و در چهار اندازه `360×800`، `390×844`،
`768×1024` و `1440×900` از نظر focus، کنتراست، target، متن بلند، overflow و
`prefers-reduced-motion` آزموده می‌شود.

## شواهد بررسی

- unit: همه `53` فایل و `208` آزمون سبز؛
- contract: همه `42` فایل و `171` آزمون سبز؛
- integration: روی زیرساخت تازه و ایزوله، همه `37` فایل و `224` آزمون به‌همراه
  هر دو آزمون سناریوی QA سبز؛
- E2E: هر چهار اجرای اختصاصی بازپرداخت سبز بود. در اجرای کامل `254` از `256`
  آزمون سبز بود؛ دو timeout اولیه در سناریوی موجود store-following و نماهای
  `390x844` و `768x1024`، در اجرای مجدد تک‌worker همان سناریوها سبز شدند؛
- lint، مرز مالکیت module، typecheck و `git diff --check` سبز؛
- migrationهای پنج producer درگیر روی PostgreSQL تازه، به ترتیب و بدون drift اجرا
  شدند. ساخت کامل Compose به‌دلیل resetهای مکرر registry هنگام دریافت metadata
  dependency در محیط اجرا تمام نشد؛ این تغییر dependency، env، port یا startup
  تازه‌ای ندارد و مسیرهای build محلی و E2E production build سبز بودند.
