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
  برای کاهش `onHand` به کمتر از رزرو فعال، کل batch را بدون اثر جزئی رد می‌کند و
  پاسخ همهٔ ردیف‌های مشکل‌دار را با `variantId` و مسیر همان ردیف برمی‌گرداند.
- audit append-only نوع عملیات، مقدار پیشین/جدید، revision پیش/پس، reason code،
  actor، correlation، زمان و یادداشت اختیاری خصوصی را نگه می‌دارد. یادداشت وارد
  رخداد، log یا پاسخ عمومی نمی‌شود.
- `VariantAvailabilityChanged.v1` فقط در inventory و هنگام عبور `available` از
  مرز صفر برای کالای منتشرشده، همراه همان mutation و با
  `correlationId/causationId` ثبت می‌شود؛ تغییر کالای منتشرنشده رخداد عمومی
  تولید نمی‌کند.
- خواندن عمومی کالا فقط `AVAILABLE/OUT_OF_STOCK` authoritative را از
  `onHand - reserved` می‌گیرد و مقدار دقیق، رزرو و SKU را افشا نمی‌کند.

## migration و سازگاری

Migration مالک inventory با نام
`20260829130000__inventory__audited-authoring` ستون اختیاری `note`، ستون‌های
صریح `operation/previous_revision/next_revision` و جدول
`inventory_idempotency_records` را به‌صورت additive اضافه می‌کند. auditهای موجود
از روی `revision` فعلی backfill می‌شوند و مقدار، actor، reason و زمان آن‌ها تغییر
نمی‌کند. پنجرهٔ سازگاری لازم نیست و اصلاح احتمالی فقط با migration forward انجام
می‌شود.

## مرز رابط

این Issue producer و API را کامل می‌کند. صفحهٔ مستقل مدیریت موجودی تا Issue
[ساخت رابط مستقل مدیریت موجودی فروشنده](https://github.com/Mahaan-Amr/sevomart/issues/145)
در ناوبری به‌صورت placeholder می‌ماند؛ بنابراین این برش DOM یا حرکت تازه‌ای ندارد.
RTL، موبایل/دسکتاپ، keyboard focus، کنتراست، متن بلند و reduced motion در Issue
رابط و QA نهایی بررسی می‌شوند و این producer دادهٔ خصوصی لازم را فقط پس از ورود
فراهم می‌کند.

## شواهد آزمون

- unit: ۱۲۵ آزمون موفق؛
- contract: ۱۴۴ آزمون موفق، شامل schemaهای خصوصی inventory، OpenAPI و hash کامل؛
- integration: ۱۵۸ آزمون موفق روی PostgreSQL تازه با ۴۵ migration؛
- پاسخ بدون نشست هر دو operation با envelope نسخه‌دار `UNAUTHORIZED` و
  `correlationId` آزموده شد؛ latency هر operation با `operationId` و خطاها با
  `operationId/code` ثبت می‌شوند.
- integration هدفمند public read: رزرو همهٔ موجودی پاسخ عمومی را
  `OUT_OF_STOCK` می‌کند و `onHand/reserved/SKU` در JSON ظاهر نمی‌شوند؛
- lint و مرزهای معماری سبز؛ typecheck همهٔ workspaceها و Prisma schema سبز.
- `docker compose up --build --wait` با ۴۵ migration و سلامت API، worker و web
  سبز شد؛ پورت‌های host فقط برای هم‌زیستی با stackهای محلی جابه‌جا شدند.
- مسیر native با `pnpm dev` همان ۴۵ migration را بدون pending migration بالا آورد؛
  `GET /health/ready` پاسخ `200/status=ok` و health وب پاسخ `200` داد.
- پس از مرور انسانی، پنج finding مربوط به جزئیات همهٔ ردیف‌های متعارض، envelope
  خطای 401، جلوگیری از رخداد کالای منتشرنشده، metricهای latency/error و شمارش
  شواهد قرارداد اصلاح و با آزمون بازتولید پوشش داده شد.
- اجرای کامل E2E: تعداد ۱۷۶ سناریو سبز بود، از جمله tracer واقعی کالا در هر چهار
  viewport. چهار failure همگی همان سناریوی legacy فروشگاه در
  `seller-application.spec.ts:136` هستند؛ این فایل و مسیر وب در diff این Issue
  تغییری ندارند و failure پیش‌موجود خارج از محدوده inventory است.
- اجرای یک‌جای `pnpm test` واحد، قرارداد و هر ۱۵۸ integration را سبز کرد و فقط به
  دلیل همان چهار failure پیش‌موجود E2E با exit code غیرصفر تمام شد.
