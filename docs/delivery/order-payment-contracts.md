# همگام‌سازی قرارداد سفارش و پرداخت

مرجع: [[ساخت] همگام‌سازی قرارداد و OpenAPI سفارش و پرداخت](https://github.com/Mahaan-Amr/sevomart/issues/118)

مبنای اجرا: `b9c3bfb4a2cc3a12ae744a01e4cde41e15747ee5`؛ predecessor migration:
`20260826090000__payments__remove-cross-module-order-fk`. این برش migration،
dependency، متغیر محیطی، پورت یا رفتار runtime تازه ندارد.

## مرجع اجرایی نسخه اول

- `@sevo/contracts/orders/v1` اکنون `ordersV1Operations`، همه stateهای سفارش،
  stateهای terminal، audit گذار و چهار رخداد سفارش را از یک entrypoint نسخه‌دار
  منتشر می‌کند.
- `@sevo/contracts/payments/v1` اکنون `paymentsV1Operations`، همه stateهای تلاش،
  stateهای terminal، audit تلاش و پنج رخداد پرداخت را از همان entrypoint نسخه‌دار
  منتشر می‌کند.
- fragmentهای OpenAPI سفارش و پرداخت، operationId، method و path را مستقیماً از
  این دو مرجع می‌گیرند. تست drift هر operation ثبت‌شده را با سند نهایی OpenAPI
  تطبیق می‌دهد.
- schemaهای state، audit و رخداد در JSON Schema/OpenAPI ثبت می‌شوند. رخدادها و
  audit فقط شناسه‌ها، state، reason code غیرحساس، correlation و timestamp لازم را
  دارند و PII، callback خام، token یا metadata خام Provider را نمی‌پذیرند.

## مرز سازگاری

شکل wire رخدادها، پاسخ‌های HTTP، routeها، status codeها و stateهای persistence
تغییر نکرده‌اند. `DISPATCHED` وضعیت پایدار انتظار برای نتیجه نخست Provider است؛
`PENDING` به `REVIEW_REQUIRED` نگاشت می‌شود، بنابراین `PENDING_RESULT` state
اجرایی جداگانه‌ای نیست. `PAID` و `EXPIRED` stateهای terminal سفارش‌اند؛
`CONFIRMED` و `FAILED` برای همان تلاش پرداخت terminal هستند. `REVIEW_REQUIRED`
retry پرداخت را می‌بندد، اما همان تلاش را برای تطبیق قطعی باز نگه می‌دارد.

مرجع operationها فقط سطح HTTP واقعاً پیاده‌شده را منتشر می‌کند. routeهای آینده
جزئیات سفارش خریدار، جزئیات فروشنده و reveal اطلاعات تحویل تا زمان وجود controller
و قرارداد پاسخ وارد OpenAPI نمی‌شوند. این برش سبد، checkout، پرداخت، migration یا
رابط را بازسازی نمی‌کند.

## راستی‌آزمایی

contract testها سازگاری `OrderBecameActionable.v1`، همه رخدادهای lifecycle تلاش
پرداخت، stateهای terminal، auditهای بدون داده حساس و drift مسیرهای OpenAPI را
می‌سنجند. regressionهای موجود سبد، checkout، رزرو، callback تکراری، پرداخت موفق،
بررسی پرداخت و handoff بدون تغییر باقی می‌مانند.

نتیجه اجرای محلی ۲۰۲۶-۰۸-۲۷: `format:check`، lint و architecture، typecheck و
build سبزند. اجرای کامل `pnpm test` با ۹۳ unit، ۹۶ contract، ۱۱۲ integration با
PostgreSQL و ۱۳۶ E2E در چهار viewport سبز است. تست‌های مرورگر همان RTL، keyboard،
کنتراست و reduced motion موجود را گذراندند. چون این برش هیچ migration، startup،
متغیر محیطی، پورت، dependency یا رفتار runtime را تغییر نمی‌دهد، ساخت کامل Compose
تازه لازم نبود؛ integration و E2E رسمی زیرساخت containerized را از صفر بالا آوردند
و همه migrationهای موجود را اعمال کردند.

پس از اصلاح یافته‌های مرور، unit، contract و integration دوباره کامل سبز شدند.
اجرای E2E دوم ۱۳۵ از ۱۳۶ مورد را گذراند و tracer انتشار در viewport `360x800`
هنگام انتظار projection از بودجه ۲۰ ثانیه گذشت؛ همان tracer در سه viewport دیگر،
در اجرای کامل پیشین و در اجرای isolated تازه `360x800` سبز شد. این failure زمان‌بندی
به تغییر قرارداد سفارش/پرداخت مرتبط نبود و حذف یا افزایش بودجه آزمون انجام نشد.
