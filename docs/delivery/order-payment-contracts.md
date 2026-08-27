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
اجرایی جداگانه‌ای نیست. فقط `PAID` در این برش state terminal سفارش است.
`EXPIRED` پرداخت تازه را می‌بندد، اما نتیجه دیررس یا متناقض می‌تواند آن را به
`PAYMENT_REVIEW` ببرد؛ این پیگیری رزرو آزادشده را باز نمی‌کند و handoff نمی‌سازد.
`CONFIRMED` و `FAILED` برای همان تلاش پرداخت terminal هستند. `REVIEW_REQUIRED`
retry پرداخت را می‌بندد، اما همان تلاش را برای تطبیق قطعی باز نگه می‌دارد.

مرجع operationها فقط سطح HTTP واقعاً پیاده‌شده را منتشر می‌کند. routeهای آینده
جزئیات سفارش خریدار، جزئیات فروشنده و reveal اطلاعات تحویل تا زمان وجود controller
و قرارداد پاسخ وارد OpenAPI نمی‌شوند. این برش سبد، checkout، پرداخت، migration یا
رابط را بازسازی نمی‌کند.

اصلاح این metadata در
[همگام‌سازی وضعیت نهایی سفارش با بازیابی پرداخت دیررس](https://github.com/Mahaan-Amr/sevomart/issues/171)
رفتار runtime یا شکل wire را تغییر نمی‌دهد؛ فقط قرارداد را با مسیر بازیابی موجود
همگام می‌کند.

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

## eligibility سفارش برای گفت‌وگو

[قرارداد و adapter بررسی تعلق سفارش برای گفت‌وگو](https://github.com/Mahaan-Amr/sevomart/issues/178)
یک seam هم‌زمان و داخلی با مالک orders اضافه می‌کند:
`OrderConversationEligibility.checkConversationOrder({ identityId, orderId, storeId })`.
شناسه هویت از نشست معتبر مصرف‌کننده می‌آید، نه body درخواست خریدار.
`orderConversationEligibilityInputContract` ورودی strict و
`orderConversationEligibilityResultContract` خروجی boolean را در orders/v1 تثبیت
می‌کنند. adapter روی `PostgresCheckoutRepository` موجود اجرا می‌شود و فقط تعلق
هم‌زمان خریدار، سفارش و فروشگاه را بررسی می‌کند. شناسه نامعتبر، سفارش ناموجود،
خریدار دیگر و فروشگاه دیگر همگی `false` هستند؛ خطای زیرساخت به معنی eligibility
نیست و برای retry به مصرف‌کننده برمی‌گردد.

وضعیت پرداخت، مهلت رزرو و قابل اقدام بودن سفارش شرط تازه‌ای برای گفت‌وگو نیستند.
نتیجه هیچ snapshot، نشانی، مبلغ یا داده تماس ندارد. مصرف‌کننده همچنان مسئول بررسی
هویت فعال و دسترسی زنده participant است و جدول orders را مستقیم نمی‌خواند.

افزودن قرارداد سازگار است و HTTP، OpenAPI عمومی، migration، env، startup و dependency
را تغییر نمی‌دهد. adapter در Docker و native از همان مسیر اتصال PostgreSQL استفاده
می‌کند. آزمون قرارداد و integration موجود، تعلق و همه وضعیت‌های سفارش را پوشش می‌دهند.
