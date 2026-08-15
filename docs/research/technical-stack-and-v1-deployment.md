# پژوهش پشته فنی و شکل استقرار نسخه اول

تاریخ بررسی: ۲۴ مرداد ۱۴۰۵ (۱۵ اوت ۲۰۲۶)

موضوع: [انتخاب پشته فنی و شکل استقرار نسخه اول](https://github.com/Mahaan-Amr/sevomart/issues/16)

## پاسخ کوتاه

بهترین تعادل برای سلینو یک **وب‌اپ واکنش‌گرا و نصب‌پذیر (PWA)، API مبتنی بر یک modular monolith و استقرار کانتینریِ قابل‌انتقال** است:

- یک monorepo تایپ‌اسکریپت با `pnpm workspace`؛
- `Next.js` برای فروشگاه عمومی، فیدها و فضای کار فروشنده، با HTML فارسی/RTL از ابتدا؛
- `NestJS` روی `Fastify` برای REST API ماژولار و یک process جدا از همان codebase برای کارهای پس‌زمینه؛
- `PostgreSQL` به‌عنوان منبع حقیقت، `Prisma` برای دسترسی نوع‌دار و migrationهای SQL قابل‌مرور؛
- جست‌وجوی نسخه اول با full-text/trigram خود PostgreSQL، صف با `pg-boss` و به‌روزرسانی زنده با SSE یا polling؛ بدون Redis، موتور جست‌وجوی جدا یا message broker تا وقتی بار واقعی نیازشان را ثابت کند؛
- ذخیره فایل در یک سرویس S3-compatible داخلی، پشت یک adapter و با upload مستقیمِ امضاشده؛
- سه کانتینر stateless برای `web`، `api` و `worker`، یک PostgreSQL مدیریت‌شده و object storage روی ارائه‌دهنده داخل ایران که sandbox، backup/restore و قراردادش آزموده شده باشد؛
- GitHub Actions برای CI، اما deploy با image استاندارد و runbook مستقل از GitHub/Vercel/Supabase/Firebase؛
- لاگ JSON با correlation ID، metrics/traces با OpenTelemetry و alert/uptime مستقل؛
- unit و integration روی PostgreSQL واقعی، contract test از OpenAPI و E2E موبایل/RTL با Playwright.

این توصیه **تصمیم نهایی ADR نیست**. پیش از تثبیت نام ارائه‌دهنده باید نمونه استقرار، restore، upload، OTP و دسترسی از چند شبکه داخل ایران اجرا شود. اگر یکی از دو توسعه‌دهنده در یک backend بالغ دیگر مانند Laravel یا Django سابقه تولیدی معنادار دارد و تیم در NestJS ندارد، همان backend آشنا با همین مرزها و قراردادها انتخاب کم‌ریسک‌تری است؛ انتخاب زبان تازه فقط برای یکسان‌شدن زبان frontend/backend توجیه ندارد.

## زمینه‌ای که تصمیم را شکل می‌دهد

سلینو در نسخه اول فقط کالای فیزیکی و تسویه مستقیم را پوشش می‌دهد، اما سفارش، موجودی، پرداخت، گفت‌وگو و پرونده اختلاف داده و state transition حساس دارند. مشاهده فروشگاه، کالا، فید و سبد نیز نباید به ورود وابسته باشد و ورودی مهم محصول لینک مستقیم فروشگاه در شبکه‌های اجتماعی است. بنابراین کانال تحویل باید هم URL عمومی، HTML قابل‌اشتراک و بارگذاری سریع داشته باشد و هم پس از ورود تجربه‌ای نزدیک به اپ بدهد.

عرضه نخست ۲۰ تا ۳۰ فروشنده و تیم دو نفره‌اند. در این مقیاس، توان rollback، restore و مشاهده خطا از autoscaling پیچیده مهم‌تر است. راهنمای رسمی معماری Microsoft نیز تصریح می‌کند microserviceها service discovery، سازگاری داده، transaction، ارتباط بین سرویس‌ها، تست و عملیات را پیچیده‌تر می‌کنند؛ این مزایا معمولاً وقتی ارزش دارند که استقلال استقرار و مقیاس هر سرویس واقعاً لازم شده باشد. اینجا نتیجه‌گیری پژوهش از آن trade-off، **modular monolith با مرزهای دامنه‌ای قابل استخراج** است، نه microservice زودهنگام. [Microsoft: Microservices architecture style](https://learn.microsoft.com/en-us/azure/architecture/microservices/)

## ۱. شکل تحویل: وب/PWA در برابر native و cross-platform

### توصیه: وب واکنش‌گرا، سپس PWA به‌صورت progressive enhancement

Next.js رسماً PWA را یک codebase چندسکویی، بدون انتظار برای تأیید app store، با نصب روی home screen و web push معرفی می‌کند. خود وب نیز در مرورگری که نصب را پشتیبانی نکند همچنان قابل استفاده می‌ماند. [راهنمای رسمی PWA در Next.js](https://nextjs.org/docs/app/guides/progressive-web-apps)؛ [MDN: نصب‌پذیری PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

این مسیر برای سلینو سه مزیت محصولی مستقیم دارد:

1. لینک فروشگاه و کالا بدون نصب و ورود باز می‌شود؛
2. یک codebase هر دو مسیر خریدار و فروشنده را پوشش می‌دهد؛
3. انتشار اصلاح امنیتی یا UX به فرایند فروشگاه نرم‌افزاری وابسته نیست.

Web Push روی iOS از نسخه 16.4 برای web app افزوده‌شده به Home Screen پشتیبانی می‌شود، اما نصب و اجازه اعلان شرط‌اند؛ پس push نباید تنها کانال رخداد حساس سفارش یا اختلاف باشد. اعلان درون‌برنامه‌ای منبع قابل‌بازبینی و SMS کانال تکمیلی باقی می‌ماند. [Apple: Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)؛ [Safari 16.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes)

محدودیت توزیع native در ایران ریسک مستقل می‌سازد: فهرست رسمی ثبت‌نام توسعه‌دهنده Google Play، ایران را پشتیبانی‌شده نشان نمی‌دهد و Apple نیز می‌گوید enrollment ممکن است به‌علت تحریم در بعضی مناطق پشتیبانی نشود. اتکا به حساب یا پرداخت کشور ثالث، زیربنای قابل‌قبول نسخه اول نیست. [Google Play: کشورهای پشتیبانی‌شده برای ثبت‌نام توسعه‌دهنده](https://support.google.com/googleplay/android-developer/answer/9306917?hl=en)؛ [Apple Developer: enrollment](https://developer.apple.com/help/account/membership/program-enrollment)

### چرا فعلاً React Native/Flutter یا native نه؟

| گزینه | سرعت یادگیری | دسترسی و توزیع در ایران | هزینه نگهداری | نتیجه نسخه اول |
|---|---|---|---|---|
| وب واکنش‌گرا + PWA | یک مسیر برای storefront و workspace | URL مستقیم؛ بدون وابستگی اجباری به store | کمترین | انتخاب |
| React Native/Flutter | قابلیت دستگاه بهتر، ولی storefront وب همچنان لازم است | توزیع Android بیرون Play ممکن، iOS دشوارتر | دست‌کم دو surface و QA بیشتر | پس از شواهد |
| native جداگانه | بهترین دسترسی به APIهای دستگاه | بیشترین وابستگی توزیع | سه client برای تیم دو نفره | رد |

trigger بازنگری: اگر داده واقعی نشان دهد upload رسانه در پس‌زمینه، push قابل‌اتکا، کار آفلاین گسترده یا retention فروشنده با PWA حل نمی‌شود، یک client cross-platform روی همان REST API ساخته شود. تا آن زمان PWA نباید «offline کامل» وعده دهد؛ shell و draftهای کم‌خطر قابل cache هستند، اما checkout، موجودی، پرداخت و وضعیت اختلاف همیشه پاسخ تازه server می‌خواهند.

## ۲. frontend پیشنهادی

- `Next.js` روی Active LTS، `React` و `TypeScript strict`؛ در زمان بررسی، Next.js 16 Active LTS است و policy رسمی توصیه می‌کند production روی Active یا Maintenance LTS باشد. patchهای امنیتی باید سریع اعمال شوند. [سیاست پشتیبانی Next.js](https://nextjs.org/support-policy)
- App Router با server rendering برای storefront و صفحه کالا؛ client component فقط برای تعامل لازم. Next.js روی Node یا Docker self-host می‌شود و حالت Node/Docker همه قابلیت‌ها را پشتیبانی می‌کند. [Next.js: deployment](https://nextjs.org/docs/app/getting-started/deploying)؛ [Next.js: self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- `lang="fa" dir="rtl"` در ریشه، CSS logical properties (`margin-inline`، `padding-inline`، `inset-inline`) و `dir="auto"` برای متن مختلط کاربر. HTML جهت `rtl` را semantic تعریف می‌کند و logical properties به مکان فیزیکی چپ/راست وابسته نیستند. [WHATWG HTML: dir](https://html.spec.whatwg.org/multipage/dom.html#the-dir-attribute)؛ [MDN: logical properties and writing modes](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout/Logical_values_and_writing_modes)
- design tokenهای مشترک و componentهای کم‌سطح؛ کتابخانه UI باید در یک spike با RTL، keyboard و screen reader تأیید شود، نه صرفاً بر اساس demo لاتین انتخاب شود.
- service worker حداقلی: manifest، نصب و cache فقط برای assetهای versioned و shell عمومی. داده خصوصی، API response، checkout و صفحه اختلاف با strategy عمومی cache نشوند.

برای نسخه اول یک instance از Next کافی است. self-hosting رسمی هشدار می‌دهد cache هر instance محلی است و در چند instance برای invalidation هماهنگ به shared cache نیاز است. بنابراین scale-out وب یک trigger صریح برای افزودن Redis/shared cache است، نه وابستگی روز اول. [Next.js: multi-instance cache coordination](https://nextjs.org/docs/app/guides/self-hosting#multi-instance-cache-coordination)

## ۳. backend و قرارداد

### modular monolith، نه «همه‌چیز در Next» و نه microservice

`NestJS` ماژول‌ها را به‌طور پیش‌فرض encapsulate می‌کند و exportهای هر ماژول interface عمومی آن‌اند؛ این با تصمیم بعدی پروژه برای مالکیت قراردادهای خریدار، فروشنده و سطح مشترک سازگار است. Nest همچنین testing container و تست HTTP را مستند و OpenAPI را مستقیم تولید می‌کند. [NestJS: modules](https://docs.nestjs.com/modules)؛ [NestJS: testing](https://docs.nestjs.com/fundamentals/testing)؛ [NestJS: OpenAPI](https://docs.nestjs.com/openapi/introduction)

ساختار پیشنهادی:

```text
apps/web       Next.js؛ فقط UI، SSR و BFF بسیار نازک
apps/api       NestJS/Fastify؛ auth، authorization و use caseها
apps/worker    bootstrap جدا از همان domain modules
packages/contracts  OpenAPI artifact و client types تولیدشده
packages/ui     tokenها و primitiveهای RTL
packages/config configهای lint/type/test
```

backend ابتدا moduleهای `identity`، `store`، `catalog`، `inventory`، `order`، `payment`، `fulfillment`، `conversation`، `dispute`، `content` و `notification` دارد، اما همه در یک deployable و یک PostgreSQL می‌مانند. هر module فقط از application API ماژول دیگر استفاده می‌کند و جدول آن را مستقیم دست‌کاری نمی‌کند. جزئیات مالکیت و dependency direction باید در تیکت بعدی تعیین شود.

REST/JSON زیر `/api/v1` با OpenAPI قرارداد بیرونی است. OpenAPI یک interface description مستقل از زبان برای فهم و تولید client/test فراهم می‌کند و Nest می‌تواند سند آن را از endpointها بسازد. artifact تولیدشده باید در CI با client تایپ‌شده مقایسه شود تا drift دیده شود. [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)؛ [NestJS Swagger](https://docs.nestjs.com/openapi/introduction)

منطق دامنه، authorization و state transition نباید در React component، Server Action یا controller پراکنده شود. Next فقط presentation و در صورت نیاز proxy هم‌مبدأ است؛ این جدایی یک client موبایل آینده و تست use caseها را ممکن می‌کند.

## ۴. داده، migration، جست‌وجو، صف و realtime

### PostgreSQL منبع حقیقت

سفارش، گونه، موجودی، پرداخت و اختلاف به constraint، transaction و قفل‌گذاری نیاز دارند. PostgreSQL isolation و retry در serialization failure را صریح مستند می‌کند. عملیات‌هایی مانند رزرو/کاهش موجودی، ثبت سفارش و outbox باید در transaction واحد، با idempotency key و constraint پایگاه داده انجام شوند. [PostgreSQL: transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

`Prisma` برای type-safe client و migration انتخاب پایه است؛ migrationهای تولیدی باید فایل SQL versioned و قابل مرور باشند و امکان custom SQL برای index، trigger یا extension حفظ شود. [Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate)

قواعد:

- پول به‌صورت integer در کوچک‌ترین واحد قراردادی و currency صریح؛ نه floating point؛
- timestamp در UTC و نمایش شمسی فقط در presentation؛
- وضعیت‌های حساس append-only audit event داشته باشند؛ لاگ فنی جای audit trail نیست؛
- migration فقط forward، با expand/migrate/contract و backup پیش از تغییر پرریسک؛
- database role برنامه حداقل privilege داشته باشد. RLS می‌تواند defense-in-depth برای داده فروشگاه باشد، اما چون owner معمولاً RLS را bypass می‌کند، جای authorization application نیست و تنها پس از تست policy/role فعال شود. [PostgreSQL: Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

### جست‌وجو

نسخه اول با نرمال‌سازی «ی/ي»، «ک/ك»، نیم‌فاصله و اعراب در ingestion، ستون search مشتق‌شده، full-text و `pg_trgm` شروع شود. `pg_trgm` similarity و index سریع برای متن‌های الفبایی را فراهم می‌کند. کیفیت روی مجموعه query فارسی واقعی سنجیده شود؛ اگر recall/ranking یا p95 در حجم واقعی رد شد، adapter جست‌وجو به Meilisearch/OpenSearch منتقل شود. [PostgreSQL full-text search](https://www.postgresql.org/docs/current/textsearch.html)؛ [PostgreSQL pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)

### کارهای پس‌زمینه و رخدادها

SMS، پردازش تصویر، اعلان، retry webhook و reconciliation نباید request را نگه دارند. `pg-boss` صف Node روی PostgreSQL است، job را می‌تواند در transaction موجود ایجاد کند و retry/dead-letter/cron دارد؛ برای تیم کوچک یک زیرساخت کمتر از Redis + BullMQ می‌خواهد. [مخزن رسمی pg-boss](https://github.com/timgit/pg-boss)

برای رخدادهای کسب‌وکاری، row در `outbox` در همان transaction تغییر دامنه نوشته و worker آن را idempotent پردازش کند. job payload فقط شناسه و نسخه قرارداد داشته باشد، نه snapshot حساس و بزرگ.

### realtime

پیام و وضعیت ابتدا در PostgreSQL commit می‌شوند؛ realtime فقط hint تحویل است. برای notification/order update، SSE server-to-client و `POST` client-to-server از WebSocket ساده‌تر است و در قطع اتصال client می‌تواند state را دوباره fetch کند. polling fallback برای شبکه‌های محدود نگه داشته شود. WebSocket/Redis adapter فقط وقتی typing/presence یا scale-out واقعی لازم شد افزوده شود. PostgreSQL `LISTEN/NOTIFY` نیز durable queue نیست و مستنداتش race آغاز listener را توضیح می‌دهد؛ فقط wake-up hint است. [WHATWG: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)؛ [PostgreSQL LISTEN](https://www.postgresql.org/docs/current/sql-listen.html)

## ۵. هویت و امنیت

### ورود

OTP موبایل مسیر اصلی و Google Identity فقط گزینه افزوده پس از آزمون داخل ایران است. OTP در adapter ارائه‌دهنده داخلی قرار می‌گیرد؛ code کوتاه‌عمر، یک‌بارمصرف و hash‌شده، با محدودیت بر شماره، IP و device، backoff، سقف ارسال و audit ضدسوءاستفاده. NIST استفاده از PSTN/SMS را authenticator «restricted» می‌داند، rate limiting و مسیر جایگزین را لازم می‌شمارد؛ بنابراین برای اقدام‌های بسیار حساس بعدی، re-authentication و عامل قوی‌تر باید قابل افزودن باشد. [NIST SP 800-63B: authenticators](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/)

session مرورگر یک opaque random ID در cookie هم‌مبدأ `Secure`، `HttpOnly` و `SameSite=Lax/Strict` است؛ token در `localStorage` ذخیره نشود. session server-side قابل revoke، با rotation پس از ورود/تغییر سطح دسترسی و expiry مطلق/idle باشد. OWASP همین cookie flags را توصیه و ذخیره credential در Web Storage را منع می‌کند. [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

### baseline امنیتی

- HTTPS/HSTS، CSP، frame protection، MIME sniffing protection و referrer policy؛ Next.js برای CSP و security headers راهنمای رسمی دارد. [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy)
- authorization deny-by-default در هر use case؛ خریدار، فروشنده، عضو فروشگاه و عملیات پلتفرم نقش‌های جدا؛
- CSRF protection برای mutationهای cookie-authenticated؛ CORS محدود یا ترجیحاً same-origin؛
- secret فقط در secret store محیط، rotation و عدم ورود به image/log؛
- webhook با signature، timestamp/replay window، idempotency و ثبت payload حداقلی؛
- upload با allowlist MIME/extension، محدودیت اندازه/مدت، نام object تصادفی، bucket خصوصی و پردازش جدا؛
- dependency lockfile، audit خودکار، patch cadence هفتگی و اضطراری برای advisory امنیتی؛
- threat model جدا برای checkout، موجودی، تسویه و اختلاف پیش از build آن‌ها.

## ۶. فایل و رسانه

رسانه نباید در PostgreSQL یا دیسک محلی کانتینر ذخیره شود. یک interface کوچک (`put/getSignedUrl/delete/copy`) روی API سازگار S3 قرار گیرد؛ client پس از گرفتن policy محدود، مستقیم upload کند و worker metadata، checksum، thumbnail و وضعیت scan را ثبت کند. S3 یک REST API استاندارد برای object storage دارد و سرویس‌های داخلی نیز سازگاری S3/AWS SDK را مستند کرده‌اند. [AWS S3 documentation](https://docs.aws.amazon.com/s3/)؛ [مستندات فضای ابری پارس‌پک](https://docs.parspack.com/cloud-storage/)

نسخه اول تصویر را پوشش دهد؛ ویدیو فقط با سقف سخت و pipeline آزمایش‌شده فعال شود، چون transcoding، moderation، bandwidth و storage هزینه عملیاتی متفاوتی دارند. فایل اصلی immutable و دسترسی public فقط برای مشتق محتوای عمومی باشد؛ مدارک اختلاف و رسانه خصوصی با URL کوتاه‌عمر بمانند.

## ۷. استقرار و محدودیت ایران

### شکل استقرار پیشنهادی

```text
Internet
   |
TLS reverse proxy / load balancer
   |-- web container (Next.js)
   |-- /api -> api container (NestJS/Fastify)
                   |-- PostgreSQL managed, private network
                   |-- S3-compatible object storage
                   `-- worker container (same release image/code)
```

برای شروع یک instance از هر app، rolling deploy یا حداقل blue/green، health/readiness، graceful shutdown و migration job یک‌بار‌اجرا کافی است. Kubernetes، service mesh و multi-region در نسخه اول رد می‌شوند.

میزبان baseline باید داخل ایران و قابل پرداخت/قرارداد با هویت واقعی پروژه باشد، اما code نباید به API اختصاصی آن قفل شود. Liara رسماً build از Dockerfile، registry خصوصی، environment variable، log و private network را عرضه می‌کند و DBaaS آن PostgreSQL، backup و کنترل public network دارد؛ این **اثبات نامزدی** است، نه انتخاب نهایی یا تضمین SLA. [Liara Docker hosting](https://liara.ir/landing/%D9%87%D8%A7%D8%B3%D8%AA-%D8%AF%D8%A7%DA%A9%D8%B1-docker)؛ [Liara DBaaS API](https://developers.liara.ir/pages/dbaas)

Vercel، Supabase managed، Cloudflare Pages/Workers، Firebase یا Google Cloud baseline تولید نیستند: حتی وقتی endpoint فنی قابل دسترس است، account، billing، export-control و دسترسی کاربر ایرانی باید قراردادی اثبات شود. مجوز عمومی OFAC Iran GL D-2 میزبانی وب برای فعالیت تجاری واقع در ایران را صریحاً از مجوز عمومی خود کنار می‌گذارد؛ پس «ارتباطات اینترنتی مجاز است» مجوز blanket برای hosting سلینو نیست. Google Cloud نیز می‌تواند برای رعایت export-control سرویس را suspend/terminate کند و دسترسی به داده پس از termination پایان می‌یابد. [OFAC Iran General License D-2، بندهای (b)(1) و (b)(4)](https://ofac.treasury.gov/system/files/126/iran_gld2.pdf)؛ [Google Cloud Terms](https://cloud.google.com/terms)

GitHub استثنای مستند است: مجوز اختصاصی OFAC آن همه cloud serviceهای رایگان و پولی را برای افراد و سازمان‌های ایران پوشش می‌دهد، هرچند payment processor ممکن است پرداخت را مسدود کند. GitHub برای source، Actions و GHCR پذیرفتنی است؛ image تولید در GHCR با digest pin شود و registry دوم/روش export برای بازیابی باقی بماند. Docker Hub dependency تولید نباشد، چون Terms رسمی آن استفاده یا export به embargoed countries و nationals/residents آن‌ها را منع می‌کند. [GitHub and Trade Controls](https://docs.github.com/en/site-policy/other-site-policies/github-and-trade-controls)؛ [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)؛ [Docker Terms، بند 10](https://www.docker.com/legal/docker-terms-use/)

### gate انتخاب ارائه‌دهنده

قبل از ADR نهایی، با دو نامزد داخلی این موارد اجرا و ثبت شود:

1. build و deploy همان image بدون CLI اختصاصی؛ rollback نسخه قبل؛
2. latency و خطا از همراه اول، ایرانسل و اینترنت ثابت در دو شهر؛
3. قطع app و DB و صحت reconnect/graceful degradation؛
4. backup خودکار، export کامل و **restore زمان‌دار روی محیط جدا**؛
5. upload/download private و public، CORS، presigned URL و هزینه egress؛
6. وضعیت private network، TLS، firewall، secret، log retention و اطلاع رخداد؛
7. سقف منابع، هزینه ماهانه در بار پایلوت و هزینه جهش ۱۰ برابری؛
8. مالکیت داده، خروج، حذف حساب، SLA و پشتیبانی قراردادی.

PostgreSQL برای PITR به base backup و archive پیوسته WAL نیاز دارد؛ داشتن نشان «backup فعال» بدون restore drill کافی نیست. [PostgreSQL: Continuous Archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)

## ۸. observability و عملیات

حداقل قابل‌قبول از نخستین production:

- JSON log ساختاریافته با `request_id`، `trace_id`، actor pseudonymous، module، outcome و latency؛ بدون OTP، token، آدرس کامل، متن مدارک یا payload پرداخت؛
- RED metrics برای HTTP و queue metrics برای depth/age/failure؛ business counters برای سفارش گیرکرده، webhook ناموفق و مغایرت موجودی؛
- OpenTelemetry در Node برای trace و metric، با OTLP exporter تا backend قابل تعویض باشد. مستندات رسمی وضعیت trace و metrics جاوااسکریپت را stable می‌داند، ولی logs را development؛ پس لاگ JSON جدا باقی بماند. [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)
- alert روی symptom: error rate، p95، queue oldest age، DB saturation، backup failure و synthetic checkout؛
- uptime probe از یک نقطه داخل ایران و یک نقطه بیرون، dashboard و runbook rollback/restore؛
- audit trail محصول جدا از telemetry و با دسترسی محدود.

برای تیم دو نفره، self-hosting یک stack بزرگ Grafana/Loki/Tempo از روز اول توجیه ندارد. ابتدا exporter استاندارد را به log/monitoring مدیریت‌شده ارائه‌دهنده منتخب وصل کنید؛ اگر retention، جست‌وجو یا قرارداد آن کافی نبود، backend observability عوض شود بدون تغییر instrumentation.

## ۹. راهبرد تست و CI

هر PR این pipeline را دارد:

1. format/lint، TypeScript، dependency/secret scan؛
2. unit test برای policy و state machine بدون شبکه؛
3. integration test هر module با PostgreSQL واقعیِ disposable و migration از صفر؛
4. API/contract test و diff سازگاری OpenAPI؛
5. E2E smoke با Playwright روی Chromium و WebKit موبایل، `locale=fa-IR`، timezone تهران و viewportهای کوچک؛ Playwright رسماً Chromium/Firefox/WebKit و mobile emulation را پشتیبانی می‌کند. [Playwright browsers](https://playwright.dev/docs/browsers)
6. accessibility و RTL assertions برای مسیرهای اصلی؛ screenshot فقط برای نقاط پایدار؛
7. build هر سه image و smoke روی Docker Compose؛
8. migration dry-run روی snapshot بی‌داده حساس؛ deploy staging؛ production با approval و smoke پس از deploy.

test pyramid بر risk متمرکز باشد: بیشترین پوشش برای مجوز فروشگاه، رزرو موجودی هم‌زمان، idempotency سفارش/پرداخت، webhook retry، transitionهای انجام سفارش و اختلاف. E2E محدود به سفرهای حیاتی «مشاهده تا ثبت سفارش»، «ساخت کالا تا موجودی» و «پیگیری سفارش» بماند تا suite کند و شکننده نشود.

## ۱۰. هزینه و مسیر رشد

هزینه پایه این معماری شامل سه compute کوچک، PostgreSQL مدیریت‌شده، object storage/egress، SMS و monitoring است. عدد تعرفه در این سند عمداً قفل نشده، چون قیمت و قرارداد سرویس‌های ایران تغییرپذیر است؛ مقایسه باید با workload ثابت (۳۰ فروشنده، تعداد کالا/تصویر، سفارش، OTP و retention لاگ) در روز انتخاب انجام شود.

| تصمیم | صرفه‌جویی امروز | trigger افزودن زیرساخت |
|---|---|---|
| PostgreSQL برای داده، search و queue | حذف Redis/search/broker و سه runbook | p95 جست‌وجو یا queue contention پس از index/tuning از SLO عبور کند |
| یک instance web/api/worker | cache و realtime ساده | CPU/latency پایدار یا نیاز availability، scale-out را توجیه کند |
| PWA | یک client و انتشار مستقیم | محدودیت device API/retention در داده واقعی ثابت شود |
| managed DB داخلی | کاهش کار patch/backup | SLA، restore یا قابلیت خروج رد شود |
| Docker/provider-neutral | جابه‌جایی و تست محلی | حفظ شود؛ orchestration فقط با چند host/service |

ترتیب رشد پیشنهادی: vertical scale و query/index tuning؛ سپس replica/connection pool و CDN داخلی برای asset عمومی؛ سپس Redis برای cache/rate limit/realtime coordination؛ سپس موتور search جدا؛ و تنها در صورت استقلال تیم/مقیاس/خرابی، استخراج یک module به service. هر مرحله باید با metric و bottleneck موجود توجیه شود.

## ADR پیشنهادی برای تیکت تصمیم

اگر spikeهای ارائه‌دهنده و مهارت تیم gate را پاس کنند، متن تصمیم می‌تواند چنین باشد:

> نسخه اول سلینو به‌صورت responsive web/PWA تحویل می‌شود. frontend با Next.js/React/TypeScript و backend به‌صورت NestJS/Fastify modular monolith در یک pnpm monorepo ساخته می‌شوند. REST/OpenAPI قرارداد client است. PostgreSQL منبع حقیقت و در نسخه اول backend جست‌وجو و queue نیز هست؛ object storage از API سازگار S3 پشت adapter استفاده می‌کند. web، api و worker به‌صورت Docker container روی ارائه‌دهنده داخلیِ آزموده مستقر می‌شوند. سرویس خارجیِ فاقد تأیید قراردادی ایران، microservice، Kubernetes، Redis، search engine مستقل و native app خارج از baseline هستند. افزودن آن‌ها فقط با trigger اندازه‌گیری‌شده انجام می‌شود.

### پیامدهای پذیرفته‌شده

- PWA بعضی قابلیت‌ها و توزیع native را ندارد، ولی reach، لینک مستقیم و سرعت انتشار را بیشینه می‌کند.
- Next + Nest دو runtime app دارند، اما presentation و domain contract را جدا می‌کنند و client آینده را ممکن می‌سازند.
- PostgreSQL چند نقش اولیه دارد؛ این پیچیدگی عملیاتی را کم می‌کند، با این هزینه که metric و trigger استخراج باید از ابتدا تعریف شوند.
- استقرار داخلی ریسک دسترسی/قرارداد خارجی را کم می‌کند، ولی کیفیت ارائه‌دهنده باید با restore و load sample اثبات شود.

## مواردی که این پژوهش تصمیم نمی‌گیرد

- نام نهایی میزبان، object storage، OTP، payment یا shipping provider؛
- مرز دقیق moduleها و مالک هر قرارداد؛
- schema نهایی و state machineهای سفارش/پرداخت/اختلاف؛
- UI kit نهایی یا طراحی تصویری؛
- ساخت scaffold، CI یا محیط production.

این موارد به‌ترتیب به نمونه قراردادی ارائه‌دهنده، تیکت «تعیین مرز ماژول‌ها و قراردادهای کار موازی» و سپس «آماده‌سازی خط پایه توسعه، تست و CI» تعلق دارند.
