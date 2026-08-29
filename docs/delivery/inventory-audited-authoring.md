# تحویل موجودی ممیزی‌شده

این سند شواهد اجرایی Issue
[تکمیل producer موجودی و اصلاح ممیزی‌شده](https://github.com/Mahaan-Amr/sevomart/issues/132)
را ثبت می‌کند.

## خروجی

- `GET /v1/seller/inventory` فهرست خصوصی گونه‌های منتشرشدهٔ فروشگاه را با مقدار
  دقیق، رزرو، مقدار قابل‌فروش، وضعیت مشتق‌شده و revision برمی‌گرداند. دسترسی به
  نشست معتبر، فروشندگی فعال و عضویت مالک محدود است.
- `PUT /v1/seller/inventory` یک batch یک تا پنجاه‌ردیفی مقصد موجودی را با reason
  code، revision هر ردیف و `Idempotency-Key` اعمال می‌کند. replay همان payload
  همان پاسخ را می‌دهد و استفادهٔ متفاوت از کلید با `IDEMPOTENCY_CONFLICT` رد
  می‌شود.
- همهٔ ردیف‌های batch در یک transaction اعمال می‌شوند. تعارض revision یا تلاش
  برای کاهش `onHand` به کمتر از رزرو فعال، کل batch را بدون اثر جزئی رد می‌کند.
- audit append-only مقدار پیشین/جدید، reason code، actor، correlation، زمان و
  یادداشت اختیاری خصوصی را نگه می‌دارد. یادداشت وارد رخداد، log یا پاسخ عمومی
  نمی‌شود.
- `VariantAvailabilityChanged.v1` فقط در inventory و هنگام عبور `available` از
  مرز صفر، همراه همان mutation و با `correlationId/causationId` ثبت می‌شود.
- خواندن عمومی کالا فقط `AVAILABLE/OUT_OF_STOCK` authoritative را از
  `onHand - reserved` می‌گیرد و مقدار دقیق، رزرو و SKU را افشا نمی‌کند.

## migration و سازگاری

Migration مالک inventory با نام
`20260829130000__inventory__audited-authoring` ستون اختیاری `note` و جدول
`inventory_idempotency_records` را به‌صورت additive اضافه می‌کند. دادهٔ موجود
بازنویسی یا حذف نمی‌شود، پنجرهٔ سازگاری لازم نیست و اصلاح احتمالی فقط با migration
forward انجام می‌شود.

## مرز رابط

این Issue producer و API را کامل می‌کند. صفحهٔ مستقل مدیریت موجودی تا Issue
[ساخت رابط مستقل مدیریت موجودی فروشنده](https://github.com/Mahaan-Amr/sevomart/issues/145)
در ناوبری به‌صورت placeholder می‌ماند؛ بنابراین این برش DOM یا حرکت تازه‌ای ندارد.
RTL، موبایل/دسکتاپ، keyboard focus، کنتراست، متن بلند و reduced motion در Issue
رابط و QA نهایی بررسی می‌شوند و این producer دادهٔ خصوصی لازم را فقط پس از ورود
فراهم می‌کند.

## شواهد آزمون

- unit: ۱۱۶ آزمون موفق؛
- contract: ۱۴۱ آزمون موفق، شامل schemaهای خصوصی inventory، OpenAPI و hash کامل؛
- integration: ۱۵۷ آزمون موفق روی PostgreSQL تازه با ۴۵ migration؛
- integration هدفمند public read: رزرو همهٔ موجودی پاسخ عمومی را
  `OUT_OF_STOCK` می‌کند و `onHand/reserved/SKU` در JSON ظاهر نمی‌شوند؛
- lint و مرزهای معماری سبز؛ typecheck همهٔ workspaceها و Prisma schema سبز.

شواهد Compose رسمی، مسیر native، E2E کامل و مرور دو محوره پس از اجرای نهایی به
همین سند و comment تحویل Issue افزوده می‌شوند.
