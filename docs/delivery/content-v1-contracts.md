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
`SYSTEM` است؛ producer ارتباط خرید و actor واقعی را در audit داخلی خود نگه
می‌دارد، نه در payload مصرف‌کنندگان عمومی.

`ContentModerationState` برای خواندن authoritative دو حالت `PUBLISHED` و `HIDDEN`
را رزرو می‌کند، اما رخدادهای انتشار فقط حالت `PUBLISHED` را می‌پذیرند. ارتباط
خصوصی `buyerId/orderItemId` فقط در persistence و audit ماژول content می‌ماند.
افزودن عملیات و رخداد تعدیل محتوا باید افزایشی باشد و نباید با تغییر ناسازگار
رخداد انتشار انجام شود.

## OpenAPI و پنجره پیاده‌سازی

fragment ماژول content همه schemaهای شناسه، eligibility، فرمان، نتیجه، خطا و
رخداد را در OpenAPI ثبت می‌کند. دو path مصوب نیز با operationId، نشست هویت،
`Idempotency-Key`، schema درخواست و نگاشت پاسخ‌های `201/401/403/409/422/428/500`
مستقیماً از قرارداد نسخه‌دار ساخته می‌شوند. controller و رفتار runtime در
[[ساخت] پیاده‌سازی producer محتوای فروش و تجربه خرید](https://github.com/Mahaan-Amr/sevomart/issues/139)
اضافه شده‌اند. نشست هویت و `Idempotency-Key` الزامی‌اند و write، audit، پاسخ replay
و outbox در یک transaction ثبت می‌شوند. یکتایی تجربه خرید با `orderItemId` در
persistence enforce می‌شود. eligibility خرید تأییدشده و تحویل از port متعلق به سفارش
`PurchaseEligibilityRead` می‌آید؛ تا compose شدن producer انجام سفارش، adapter
runtime عمداً `NOT_ELIGIBLE` برمی‌گرداند و سفر ناقص در ناوبری عمومی قرار نمی‌گیرد.

محتوای فروش snapshot نسخه انتشار هر کالای متصل را نگه می‌دارد. worker رخدادهای
`ProductPublished.v1/v2` و `ProductUnpublished.v1` را idempotent مصرف می‌کند. projection
مالک content آخرین `aggregateVersion` کالا را نگه می‌دارد، رخداد stale را رد می‌کند،
انتشار را با همان lock تراکنشی هماهنگ می‌کند و وقتی هیچ اتصال فعالی نماند خود محتوا را
غیرفعال می‌کند. این projection داده ماژول product را مستقیم query یا تغییر نمی‌دهد.

## راستی‌آزمایی

contract testها حداقل یک کالای یکتا، هم‌فروشگاهی و منتشرشده، خرید تأییدشده و تحویل‌شده،
رد submission تکراری، validation امتیاز و رسانه، تمایز قطعی منبع رخداد، نبود
شناسه خریدار و سفارش در payload عمومی و mapping کامل OpenAPI را
می‌سنجند. آزمون unit سرویس authorization و eligibility را در مرز application
می‌سنجد. آزمون integration روی PostgreSQL واقعی، migration، replay idempotent،
یکتایی submission، audit/outbox بدون شناسه خصوصی، deactivation رخدادمحور و compose
شدن دو route را می‌سنجد. OpenAPI همچنان از artifact نسخه‌دار v1 ساخته می‌شود.

نتیجه نهایی محلی ۲۰۲۶-۰۸-۲۹: `format:check`، lint و architecture، typecheck و
build سبزند؛ ۱۱۹ unit، ۱۴۰ contract و ۱۶۱ integration سبزند و integration همه ۴۵
migration موجود را از صفر اعمال کرد. اجرای کامل E2E از ۱۸۰ سناریو، ۱۷۴ مورد را
سبز کرد؛ چهار شکست baseline مربوط به `seller-application` از main و دو شکست نخست
tracer به‌دلیل state مشترک applicant بودند و همان tracer در دو viewport بعدی سبز
شد. مسیر native با هر سه healthcheck سبز شد. Compose پیش از build پروژه سه‌بار در
دریافت metadata `docker/dockerfile:1.7` از Docker Hub timeout شد؛ بنابراین failure
ثبت‌شده بیرونی است و نه failure migration یا runtime پروژه.
