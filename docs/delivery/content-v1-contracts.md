# قرارداد محتوای فروش و تجربه خرید نسخه اول

مرجع: [[ساخت] تثبیت قرارداد محتوای فروش و تجربه خرید](https://github.com/Mahaan-Amr/sevomart/issues/120)

مبنای اجرایی: `484b672ab5ccc2944657180188ada9c01d0f7b9c` از شاخه مقصد
`ferpheri`؛ `origin/main` هنگام شروع روی
`b9c3bfb4a2cc3a12ae744a01e4cde41e15747ee5` بود. predecessor migration برابر
`20260826090000__payments__remove-cross-module-order-fk` است. این برش migration،
dependency، متغیر محیطی، پورت یا رفتار runtime تازه ندارد.

## قرارداد اجرایی

- `@sevo/contracts/content/v1` دو operation مصوب `PublishSalesContent.v1` و
  `PublishPurchaseExperience.v1` را با path، شناسه idempotency، ورودی، نتیجه،
  خطا و رخداد نسخه‌دار تثبیت می‌کند.
- محتوای فروش حداقل یک و حداکثر ده `productId` یکتا می‌پذیرد.
  `SalesContentProductEligibilityDecision` فقط وقتی مثبت است که همه کالاها
  منتشرشده، یکتا و متعلق به همان فروشگاه باشند؛ حالت منفی فقط
  `NO_ACTIVE_PRODUCT` یا `FORBIDDEN` است.
- `PurchaseExperienceEligibilityDecision` خرید تأییدشده و سفارش تحویل‌شده را با
  `buyerId`، `orderItemId`، فروشگاه و کالا ثبت می‌کند. نتیجه منفی `NOT_ELIGIBLE` یا
  `ALREADY_SUBMITTED` است؛ بنابراین producer می‌تواند یکتایی submission را روی
  `orderItemId` به‌طور قراردادی و در persistence آینده enforce کند.
- امتیاز تجربه خرید از ۱ تا ۵، متن حداکثر ۲۰۰۰ نویسه و رسانه یکتای حداکثر چهار
  مورد است. رسانه محتوای فروش صریحاً `IMAGE` یا `VIDEO` است و قرارداد مالکیت یا
  پردازش رسانه ماژول media را بازتعریف نمی‌کند.

## مرز منبع و حریم خصوصی

`SalesContentPublished.v1` همیشه `source: SELLER` و
`PurchaseExperiencePublished.v1` همیشه `source: VERIFIED_PURCHASE` دارد؛ هر دو
رخداد `moderationState: PUBLISHED` را صریح حمل می‌کنند و schema یکدیگر را
نمی‌پذیرند. رخداد عمومی تجربه خرید `buyerId` و `orderItemId` ندارد و actor آن
`SYSTEM` است؛ producer آینده باید ارتباط خرید و actor واقعی را در audit داخلی
خود نگه دارد، نه در payload مصرف‌کنندگان عمومی.

`ContentModerationState` برای خواندن authoritative دو حالت `PUBLISHED` و `HIDDEN`
را رزرو می‌کند، اما رخدادهای انتشار این برش فقط حالت `PUBLISHED` را می‌پذیرند.
افزودن عملیات و رخداد تعدیل محتوا به Issue producer تعلق دارد و نباید با تغییر
ناسازگار رخداد انتشار انجام شود.

## OpenAPI و پنجره پیاده‌سازی

fragment ماژول content همه schemaهای شناسه، eligibility، فرمان، نتیجه، خطا و
رخداد را در OpenAPI ثبت می‌کند. دو path مصوب نیز با operationId، نشست هویت،
`Idempotency-Key`، schema درخواست و نگاشت پاسخ‌های `201/401/403/409/422/428/500`
مستقیماً از قرارداد نسخه‌دار ساخته می‌شوند. controller و رفتار runtime در
[[ساخت] پیاده‌سازی producer محتوای فروش و تجربه خرید](https://github.com/Mahaan-Amr/sevomart/issues/139)
اضافه می‌شود و تا آن زمان سفر ناقص در ناوبری عمومی قرار نمی‌گیرد.

## راستی‌آزمایی

contract testها حداقل یک کالای یکتا، هم‌فروشگاهی و منتشرشده، خرید تأییدشده و تحویل‌شده،
رد submission تکراری، validation امتیاز و رسانه، تمایز قطعی منبع رخداد، نبود
شناسه خریدار و سفارش در payload عمومی و mapping کامل OpenAPI را
می‌سنجند. چون این برش runtime، schema پایگاه داده، migration، startup یا رابط را
تغییر نمی‌دهد، integration/E2E و ساخت دوباره Compose برای خود این تغییر seam
مناسبی نیستند؛ نتیجه بررسی‌های کامل مخزن در handoff Issue ثبت می‌شود.

نتیجه نهایی محلی ۲۰۲۶-۰۸-۲۷: `format:check`، lint و architecture، typecheck و
build سبزند؛ ۹۳ unit، ۱۱۷ contract و ۱۱۲ integration سبزند و integration همه ۴۱
migration موجود را از صفر اعمال کرد. اجرای E2E ایزوله ۱۳۲ مورد را سبز کرد و چهار
tracer سراسری به‌دلیل invocation مستقیم Playwright و نبود `npm_execpath` شکست
خوردند؛ همان چهار tracer در دیتابیس تازه، مسیر رسمی `pnpm test:e2e` و یک worker
دوباره اجرا و سبز شدند. در مجموع هر ۱۳۶ سناریوی E2E در چهار viewport شاهد سبز
دارد. migration تازه‌ای در این برش وجود ندارد.
