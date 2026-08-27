# قرارداد کالا و موجودی و انتشار canonical

مرجع: [[ساخت] تثبیت رخدادهای کالا و موجودی و مهاجرت ProductPublished.v2](https://github.com/Mahaan-Amr/sevomart/issues/117).
مبنای اجرا و مرور: `b9e53831ef89d1f975e985ef67d4df2fc4ff0d06`؛ predecessor migration:
`20260826090000__payments__remove-cross-module-order-fk`.
این برش migration، dependency، متغیر محیطی، پورت یا endpoint تازه ندارد.

## قرارداد اجرایی و مالکیت

- `@sevo/contracts/inventory/v1` تنها تعریف `VariantAvailabilityChanged.v1` و
  `InventoryAvailabilityReadV1` را عرضه می‌کند. import رخداد از product حذف شده
  و همه مصرف‌کنندگان مخزن به subpath مالک مهاجرت کرده‌اند؛ شکل wire رخداد عوض نشده است.
- `InventoryAuthoring.read`، `readMany` و `readInTransaction` همان شکل داخلی موجود
  را با schema اجرایی برمی‌گردانند: `onHand`، `reserved`، `available` و `revision`.
  `available = onHand - reserved` است؛ در اصلاح شمارش به کمتر از رزرو می‌تواند
  منفی شود. موجودی ناموجود `undefined` و نتیجه چندخوانی فقط شامل موارد موجود است.
  تعدادهای دقیق داخلی‌اند و به پاسخ عمومی کالا اضافه نشده‌اند.
- `ProductAuthoritativeVariantV1` قرارداد قیمت جاری، شناسه‌های کالا/گونه/فروشگاه،
  نام و تصویر منتشرشده، `publicationVersion` و `sellable` است. قیمت از offer جاری
  می‌آید، نه snapshot محتوا؛ ویرایش نسخه کاری نام/تصویر منتشرشده را عوض نمی‌کند.
  گونه غایب از انتشار جاری `undefined` است. `sellable` وضعیت انتشار کالا را بیان
  می‌کند و جای بررسی جداگانه مجوز فروشنده، فروشگاه یا موجودی را نمی‌گیرد.
- schemaهای خواندن داخلی و رخدادهای انتشار، توقف، قیمت و availability از fragmentهای
  product و inventory در OpenAPI ثبت می‌شوند؛ endpoint عمومی برای خواندن داخلی
  اضافه نشده است. hash سطح کامل فقط به دلیل این schemaهای افزوده تغییر کرده است.

## رخداد موجودی

در اصلاح گروهی موجودی منتشرشده، product فقط context انتشار را به inventory می‌دهد.
inventory قفل و revision، محاسبه reservation-aware، اصلاح شمارش، audit و enqueue
را در تراکنش موجود انجام می‌دهد. `aggregateId` شناسه گونه و `aggregateVersion` و
`availabilityVersion` همان revision اصلاح موجودی‌اند. تغییر مثبت به مثبت یا
غیرمثبت به غیرمثبت رخداد عمومی ندارد؛ شکست revision یا rollback، mutation و رخداد
را با هم برمی‌گرداند. فرمان بدون context انتشار، از جمله آماده‌سازی پیش‌نویس،
رخداد عمومی نمی‌سازد.

این انتقال مالکیت، lifecycle رزرو/پرداخت را بازسازی نمی‌کند. انتشار رخداد برای
تغییر ناشی از رزرو یا صرف گذشت زمان در emitter فعلی وجود ندارد؛ خواندن authoritative
همچنان رزرو فعال، نگه‌داری برای بررسی و انقضا را زنده محاسبه می‌کند. projection
منبع تصمیم خرید نیست. افزودن رخدادهای lifecycle رزرو به context پایدار و ترتیب نسخه
مستقل نیاز دارد و نباید با خواندن جدول product از inventory انجام شود.

## مهاجرت انتشار و پنجره سازگاری

تولیدکننده‌های ساده و چندگونه فقط `ProductPublished.v2` می‌فرستند. schema آن
`snapshot.variantIds` را الزام می‌کند و محتوای نمایشی v1 یا تعداد موجودی را نمی‌پذیرد.
envelope همچنان نسخه ۱ دارد؛ نسخه envelope و نوع رخداد دو مفهوم مستقل‌اند.

مسیر اصلی discovery نسخه دوم را parse می‌کند. تنها مصرف v1 در adapter مشخص
`legacy-product-publication.ts` برای live catch-up و replay تاریخچه است. adapter
فقط شناسه‌ها، زمان و نسخه‌های لازم برای projection را می‌گیرد؛ از snapshot قدیمی
شناسه گونه اختراع نمی‌کند و رخداد v1 را دوباره به اسم v2 منتشر نمی‌کند.
اعلان worker و فهرست رخدادهای rebuild، v1 را تا پایان این پنجره نگه می‌دارند.

وضعیت: v2 **مصوب، قابل اجرا و مصرف‌شده در مسیر جاری**؛ v1 **قابل حذف نیست** چون
تاریخچه outbox می‌تواند به آن نیاز داشته باشد. پیش از حذف باید نبود producer و
consumer زنده v1، تخلیه backlog و امکان rebuild تاریخچه بدون از دست‌دادن
`firstPublishedAt` اثبات و در Issue ثبت شود. rollback بدون migration است؛ در forward-fix
نباید wire v1/v2 یا outbox تاریخی بازنویسی شوند.

## راستی‌آزمایی

آزمون‌ها سطح قراردادهای خواندن، payloadهای نامعتبر و خصوصی، emission واقعی، عبور
availability از مرز رزرو، rollback، revision conflict و replay ترکیبی v1/v2 را
پوشش می‌دهند. سفر HTTP موجود، انتشار/توقف/بازانتشار، قیمت زنده و رخدادهای واقعی
outbox را نیز با schema مالک می‌سنجد. UI یا baseline بصری تغییر نکرده است.

نتایج نهایی اجرای native، Docker و مرور مستقل پس از اتمام بررسی‌ها در این سند
و comment تحویل ثبت می‌شوند. مرور انسانی @ferpheri جداگانه لازم است.
