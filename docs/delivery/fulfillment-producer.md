# تحویل producer انجام سفارش و خط زمانی رهگیری

مرجع اجرا: [پیاده‌سازی producer انجام سفارش و خط زمانی رهگیری](https://github.com/Mahaan-Amr/sevomart/issues/134).
مبنای اجرا `1cad113` و predecessor migration برابر
`20260830113000__identity-access__audit-unresolved-sensitive-attempts` است.

## نتیجه

- مصرف idempotent رخداد `OrderBecameActionable.v1` فقط سفارش پرداخت‌شده را با
  وضعیت `ACTION_REQUIRED` وارد ماژول انجام سفارش می‌کند.
- state machine مستقل انجام سفارش فقط مسیر
  `ACTION_REQUIRED → PREPARING → SHIPPED → DELIVERED` را می‌پذیرد. لغو، بازپرداخت
  و اختلاف در این state ذخیره نمی‌شوند و در نتیجه timeline انجام سفارش را
  جایگزین نمی‌کنند.
- `AdvanceFulfillment.v1` برای `SHIPPED` روش ارسال را الزامی و کد رهگیری را
  اختیاری می‌گیرد. هر تغییر actor، زمان، correlation و نسخه افزایشی دارد؛ رخداد
  outbox causation درخواست آغازگر را حفظ می‌کند و فقط وضعیت‌های پیشین/بعدی و
  envelope ممیزی را حمل می‌کند؛ کد رهگیری یا داده خریدار در آن منتشر نمی‌شود.
- تغییر وضعیت با هویت `ADVANCE + orderId + actorId + key`، hash درخواست، وضعیت
  `IN_PROGRESS | COMPLETED` و lease سی‌ثانیه‌ای ثبت می‌شود. درخواست هم‌زمان با
  `409 IDEMPOTENCY_IN_PROGRESS` و `Retry-After` پاسخ می‌گیرد و replay تکمیل‌شده
  همان timeline قبلی را بدون اثر دوم برمی‌گرداند.
- فروشنده فقط سفارش پرداخت‌شده همان فروشگاه را تغییر می‌دهد. readهای فروشنده و
  خریدار از یک projection و یک قرارداد timeline استفاده می‌کنند و پاسخ HTTP هر
  دو `Cache-Control: no-store` است.
- read داخلی نسخه‌دار `FulfillmentOrderSnapshot.v1` پس از ارسال، مالکیت تأییدشده
  خریدار و فروشگاه، وضعیت fulfillment و زمان واقعی `SHIPPED`/`DELIVERED` را برای
  eligibility اختلاف منتشر می‌کند. این snapshot فقط پس از تطبیق خریدار با سفارش
  ساخته می‌شود و داده تماس، آدرس یا کد رهگیری ندارد.

## قرارداد و سازگاری

entrypoint موجود `@sevo/contracts/fulfillment/v1` از scaffold به قرارداد اجرایی
افزودنی تبدیل شد و سه operation، schemaهای timeline/ارسال/خطا و رخداد
`FulfillmentAdvanced.v1` را منتشر می‌کند. قرارداد read داخلی
`FULFILLMENT_AUTHORITATIVE_READ` با snapshot دارای `version: 1` seam پایدار مصرف‌کننده
Issue ۱۴۰ است. نسخه پیشین artifact اجرایی نداشت؛ بنابراین پنجره سازگاری یا حذف
مصرف‌کننده لازم نیست. OpenAPI در slot از پیش موجود همان ماژول ترکیب می‌شود و قرارداد
producer دیگری تغییر نکرده است.

## داده و migration

migration افزودنی `20260830120000__fulfillment__order-state-timeline` سه جدول مالک
fulfillment برای aggregate، timeline و replay idempotency می‌سازد. `storeId` مالک
فروشگاه هنگام نخستین transition فروشنده در aggregate ثبت می‌شود. تنها foreign key
میان دو جدول همان ماژول است؛ `orderId` و `storeId` نسبت به ماژول‌های دیگر scalar
باقی می‌مانند. migration
منتشرشده بازنویسی نمی‌شود و اصلاح احتمالی فقط با forward migration انجام خواهد شد.
dependency، متغیر محیطی، secret، پورت یا startup تازه‌ای اضافه نشده است و Docker و
native همان تاریخچه `prisma migrate deploy` را مصرف می‌کنند.

## شواهد

- unit: transition بعدی، actor/time/correlation، برابری read خریدار/فروشنده،
  snapshot نسخه‌دار و جلوگیری از دسترسی نامرتبط؛
- contract: operationها، الزام روش ارسال، timeline، snapshot و رخداد بدون داده حساس؛
- integration روی PostgreSQL تازه: مصرف تکراری handoff، replay، رقابت transition،
  تعارض و درخواست درحال‌اجرای idempotency، حفظ causation، مسیر کامل تا
  `DELIVERED`، زمان‌های snapshot، outbox اتمیک و مسیرهای HTTP واقعی
  فروشنده/خریدار؛
- `docker compose up --build --wait`: API، وب، worker، PostgreSQL و MinIO همگی
  healthy؛
- `pnpm dev`: migration تازه و build packageها موفق، API و worker آماده، health API
  برابر ۲۰۰ و صفحه وب برابر ۲۰۰؛
- دروازه سراسری: ۱۶۲ unit، ۱۵۷ contract و ۱۸۴ integration روی زیرساخت اختصاصی
  سبز؛ format، lint، مرزبندی معماری و typecheck نیز سبز؛
- E2E: مسیر release-critical در هر چهار viewport و در مجموع ۲۰۰ آزمون سبز است.
  ۸ مقایسه تصویر موجودِ Storefront در دو سناریو و چهار viewport به‌دلیل اختلاف
  baseline قدیمی شکست می‌خورند؛ این شاخه هیچ فایل وب، CSS یا snapshot تصویری را
  تغییر نمی‌دهد و snapshotهای خارج از محدوده بازنویسی نشده‌اند.

این Issue رابط وب یا ناوبری عمومی اضافه نمی‌کند؛ رابط‌های فارسی/RTL فروشنده و
خریدار به‌ترتیب در Issueهای وابسته ۱۴۹ و ۱۴۸ ساخته می‌شوند. پاسخ‌های خطای API این
برش فارسی، کوتاه و دارای قدم اصلاح روشن‌اند.
