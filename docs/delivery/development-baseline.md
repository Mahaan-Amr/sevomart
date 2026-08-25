# خط پایه توسعه

این راهنما خروجی مسئلهٔ [آماده‌سازی خط پایه توسعه، تست و CI](https://github.com/Mahaan-Amr/sevomart/issues/18)
است. هدف آن فراهم‌کردن یک نقطه شروع مشترک برای دو مسیر مستقل خریدار و فروشنده است.

## پیش‌نیاز و شروع

- Node.js `22.13+`، Corepack و Docker Desktop؛
- Chrome محلی برای E2E توسعه؛ CI از Chromium ایزوله Playwright استفاده می‌کند؛
- اجرای `corepack enable` و سپس `pnpm install`؛
- اجرای `pnpm compose:up` برای محیط رسمی کامل شامل PostgreSQL، MinIO، migration، API، worker و web؛
- اجرای `pnpm dev` برای همان زیرساخت با web، API و worker بومی و hot reload؛
- web در `http://localhost:3200`، API در `http://localhost:3201` و OpenAPI در
  `http://localhost:3201/openapi` است؛ همهٔ این پورت‌ها از `.env` قابل تغییرند.

مقادیر محلی غیرحساس در `.env.example` ثبت شده‌اند. secret واقعی فقط در محیط اجرا نگهداری
می‌شود و فایل `.env` وارد Git نیست. `pnpm infra:down` و `pnpm compose:down` volume را حذف
نمی‌کنند. `pnpm local:reset` تنها فرمان حذف صریح دادهٔ PostgreSQL و MinIO است و پیش از حذف
نام دقیق volumeها را نمایش می‌دهد و تأیید می‌خواهد.

## فرمان‌های کیفیت

| فرمان                   | مرز بررسی                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm format:check`     | قالب فایل‌ها                                                                             |
| `pnpm lint`             | ESLint و جهت importهای معماری                                                            |
| `pnpm typecheck`        | TypeScript strict و Prisma schema                                                        |
| `pnpm test:unit`        | قراردادهای کوچک بدون I/O                                                                 |
| `pnpm test:contract`    | fake آداپترها و compatibility قرارداد                                                    |
| `pnpm test:integration` | API و سپس هر ماژول روی PostgreSQL واقعی؛ در محیط محلی پایگاه داده را خودکار بالا می‌آورد |
| `pnpm test:e2e`         | مسیر موبایل و RTL در Chromium                                                            |
| `pnpm quality`          | کنترل سریع پیش از commit                                                                 |
| `pnpm test`             | همه سطح‌های آزمون                                                                        |

تست integration یک query واقعی روی PostgreSQL اجرا می‌کند و بدون اتصال سالم پاس نمی‌شود.
در CI، `DATABASE_URL` به سرویس PostgreSQL همان job اشاره می‌کند. CI همین فرمان‌ها را با نصب قفل‌شده و `pnpm audit --prod` اجرا می‌کند. imageهای web، API و
worker از Dockerfileهای مستقل ولی با context ریشه ساخته می‌شوند.

## افزودن ماژول

1. نام مصوب ADR-002 را از `docs/architecture/module-ownership.json` انتخاب کنید.
2. مالکیت interface، جدول و migration را در Issue اعلام کنید.
3. `node scripts/create-module.mjs <module-name>` را اجرا کنید.
   این فرمان entrypointهای API، worker، قرارداد نسخه‌دار، OpenAPI و schema ماژول را
   بدون بازنویسی فایل موجود آماده می‌کند.
4. فقط contractهای هم‌زمان پایدار را از `public.ts` export کنید. adapterهای لازم برای
   composition فقط از `composition.ts` منتشر می‌شوند. import implementation
   ماژول دیگر با `pnpm check:architecture` رد می‌شود.
5. migration را با قالب `YYYYMMDDHHMMSS__<module>__<change>` بسازید و برنامه forward-fix
   یا rollback را در PR بنویسید.
6. رفتار را از interface عمومی با integration test روی PostgreSQL واقعی بیازمایید.

## قرارداد و fake

`@sevo/contracts` فقط قراردادهای واقعاً مشترک مانند پاسخ سلامت و قالب خطا را دارد؛
مدل دامنه مشترک در آن قرار نمی‌گیرد. نمونه `ObjectStoragePort` داخل ماژول رسانه مالکیت
قرارداد را نشان می‌دهد و `FakeObjectStorage` همان contract suite را اجرا می‌کند. adapter
واقعی S3 نیز باید همان suite را پاس کند؛ تست دامنه هرگز به provider واقعی متصل نمی‌شود.

افزودن فیلد اختیاری سازگار است. تغییر ناسازگار با افزودن نسخه جدید، مهاجرت مصرف‌کنندگان
و سپس حذف نسخه قدیمی انجام می‌شود. OpenAPI مرجع قرارداد REST برای web است.

## محیط و مشاهده‌پذیری

Fastify لاگ JSON و `x-correlation-id` تولید یا عبور می‌دهد. اگر
`OTEL_EXPORTER_OTLP_ENDPOINT` تنظیم شود، API و worker traceهای OpenTelemetry را به collector
می‌فرستند؛ خالی‌بودن آن در توسعه محلی معتبر است. هیچ داده حساس یا payload کاربر نباید در
log، trace، fixture یا Issue ثبت شود.

## outbox و Worker پایدار

تغییر دامنه‌ای مهم، رخداد نسخه‌دار و بدون PII را با `@sevo/outbox` در همان
transaction PostgreSQL ثبت می‌کند. Worker در هر دو مسیر `pnpm dev` و
`pnpm compose:up` اجرا می‌شود و رکوردهای آماده را با lease claim می‌کند. تحویل
حداقل یک‌بار است؛ consumer باید اثر دامنه و receipt را در یک transaction بنویسد.

retry با backoff محدود انجام می‌شود. پس از پایان تلاش‌ها، رکورد با وضعیت `FAILED`،
تعداد تلاش، زمان شکست و دسته خطا در `platform_outbox_events` باقی می‌ماند؛ payload
و داده حساس وارد log یا متن خطا نمی‌شود. shutdown عادی منتظر پردازش جاری می‌ماند و
پس از crash، Worker تازه پیام `LEASED` با lease منقضی را دوباره claim می‌کند.

tracer فعلی `StorePublished.v1` است: انتشار فروشگاه و outbox اتمیک‌اند و consumer
`reporting-store-publications-v1` projection خصوصی گزارش/آمار را با receipt
idempotent به‌روز می‌کند. این projection آمار عمومی یا داده تازه‌ای به رابط اضافه
نمی‌کند.

تأیید فروشندگی پیش از اجرای transaction اتمیک، فقط شناسه بازیابی و command داخلی لازم
را پایدار می‌کند. اگر API میان ثبت قصد و پایان provision متوقف شود، poller اختصاصی
Worker یک command با وضعیت `PENDING` را از endpoint داخلی محدود می‌خواند و همان command
را idempotent ادامه می‌دهد. journal تا ثبت `COMPLETED` در transaction نهایی صف پایدار
بازیابی است و poller خطای موقت را بدون سقف تلاش دوباره امتحان می‌کند. داده درخواست از
مرز polling عبور نمی‌کند. ارتباط Worker با API از `INTERNAL_API_URL` و secret مشترک
`SELLER_APPROVAL_RECOVERY_SECRET` استفاده می‌کند؛ مقدار محلی `.env.example` در production
ممنوع است. اگر بازبینی در زمان بازیابی دیگر مجاز نباشد—برای نمونه مجوز عامل لغو شده
باشد—همان ماژول recovery را با audit شکست به `CANCELLED` می‌برد تا command نامعتبر
دوباره اجرا نشود و بازیابی‌های بعدی متوقف نمانند.

بازیابی پرداخت نیز با poller ماژول پرداخت Worker و operation داخلی API انجام می‌شود.
Worker با `PAYMENT_RECOVERY_SECRET` تلاش‌های دارای lease منقضی و تطبیق‌های سررسیدشده
را claim می‌کند؛ تماس با ارائه‌دهنده بیرون transaction می‌ماند و زمان retry بعدی در
پایگاه داده پایدار است. مقدار محلی این secret در `.env.example` فقط برای توسعه است و
در production پذیرفته نمی‌شود.

توکن دسترسی سبد مهمان از `CART_TOKEN_DERIVATION_SECRET` و کلید idempotency درخواست
به‌صورت HMAC مشتق می‌شود تا retry نخستین افزودن، حتی پیش از دریافت cookie، همان سبد را
برگرداند. مقدار محلی `.env.example` برای production ممنوع است و باید در مسیر Docker و
native با secret مستقل و حداقل ۳۲ نویسه جایگزین شود.

برای migrationهای تأیید فروشندگی، هم مسیر native با
`pnpm --filter @sevo/database exec prisma migrate deploy` سپس اجرای API/Worker از
`pnpm dev`، و هم مسیر رسمی با `pnpm compose:up` بررسی می‌شوند. پذیرش این تغییر مستلزم
سبزشدن health هر دو پردازش و پردازش یک recovery پس از restart API در تست integration
است؛ این بررسی از ساخت imageهای جداگانه API، Worker و migrate نیز محافظت می‌کند.

فید عمومی کشف cursor را با کلید فعال `DISCOVERY_CURSOR_ACTIVE_KEY_ID` در keyring
نسخه‌دار `DISCOVERY_CURSOR_KEYRING` امضا می‌کند و seed رتبه‌بندی را جداگانه از
`DISCOVERY_RANKING_SECRET` می‌سازد. مقدارهای محلی یکسان در `.env.example` و
`compose.yaml` فقط برای توسعه بازتولیدپذیرند و startup production آن‌ها را رد
می‌کند. مسیر native و Compose باید این متغیرها را هم‌زمان دریافت کنند و هنگام
rotation، کلید قبلی تا پایان عمر ۲۴ساعته cursorهای صادرشده در keyring بماند.

projection فروش‌پذیری کشف هر ۱۵ ثانیه پایش می‌شود و SLO lag آن ۶۰ ثانیه است.
تا پیش از عبور از این مرز، پاسخ فید هر کارت را دوباره با read معتبر کالا و فروشگاه
می‌سنجد و فقط کم‌نمایی موقت مجاز است. lag بیشتر، buffer حل‌نشده یا poison event
فید را با `503 PROJECTION_UNAVAILABLE` می‌بندد. همان پایش gaugeهای OpenTelemetry
برای `healthy`، lag، رخدادهای در انتظار/poison و buffer حل‌نشده صادر می‌کند؛ شمار
replay و rebuild و مدت rebuild نیز metric عملیاتی‌اند. رکورد
`discovery_projection_alert` سیگنال alert پایدار projection ناسالم و رکورد
`discovery_projection_rebuild_failed` سیگنال alert شکست rebuild است. collector باید
اولی را پس از دو دورهٔ ۱۵ثانیه‌ای و دومی را با هر رخداد به on-call هدایت کند. log و
metric فقط شمار aggregate دارند و payload، شناسه فروشگاه/کالا و PII را ثبت نمی‌کنند.
هر replay آرشیوی نیز با rule هشدار `SevoDiscoveryProjectionReplayActivity` برای
بررسی اپراتور قابل مشاهده است؛ این هشدار فعالیت بازیابی را گزارش می‌کند و به‌تنهایی
به معنی ناسالم بودن projection نیست.
ruleهای قابل‌بارگذاری Prometheus برای projection ناسالم، lag خارج از SLO، poison،
version gap/buffer ماندگار و شکست تکراری rebuild در
`ops/alerts/discovery-public-feed.prometheus.yml` نگه‌داری می‌شوند. نام‌های آن فایل
بر اساس تبدیل استاندارد نام و unit در OTLP-to-Prometheus هستند و deployment باید
فایل را در rule loader مانیتورینگ بارگذاری کند.

metrics با همان پشتهٔ موجود OpenTelemetry و exporter استاندارد OTLP صادر می‌شوند؛
وابستگی‌های مستقیم `@opentelemetry/api`، `sdk-metrics` و
`exporter-metrics-otlp-http` هم‌نسخه با SDK موجود، تحت مجوز Apache-2.0 و بدون
وابستگی به ارائه‌دهندهٔ telemetry خاص نگه داشته شده‌اند. این بسته‌ها اجزای فعال و
منتشرشوندهٔ پروژهٔ رسمی OpenTelemetry هستند. ارزیابی امنیتی آن‌ها dependency یا
credential تازه‌ای خارج از زنجیرهٔ OpenTelemetry وارد نمی‌کند؛ اثر runtime به ارسال
خروجی aggregate به endpoint ازپیش‌مجاز OTLP محدود است و lockfile و کنترل
supply-chain مخزن نسخه‌های دقیق را تثبیت می‌کنند.
parser توسعه‌ای `yaml` نیز فقط برای اعتبارسنجی خودکار syntax و قرارداد ruleهای
Prometheus استفاده می‌شود؛ پروژهٔ فعال YAML، مجوز ISC، نسخهٔ lockشده و نبود هرگونه
ورودی غیرقابل‌اعتماد یا اثر runtime آن، سطح امنیتی را به parsing فایل ثابت مخزن
محدود می‌کند.

بازسازی کامل از آرشیو outbox با قفل تراکنشی و بدون نمایش حالت نیمه‌ساخته انجام
می‌شود. اپراتور پس از اطمینان از اتصال به پایگاه مقصد، در PowerShell دستور زیر را
اجرا می‌کند؛ مقدار تأیید از اجرای تصادفی جلوگیری می‌کند:

```powershell
$env:SEVO_REBUILD_CONFIRM='public-feed-v1'
pnpm projection:rebuild:discovery
```

رخدادهای در انتظار پس از rebuild همچنان با receipt عادی worker مصرف می‌شوند.
خروجی فقط تعداد replay، مدت، lag، poison و buffer را گزارش می‌کند؛ شکست replay کل
تراکنش را rollback می‌کند و projection پیشین باقی می‌ماند.
