# مشخصات ساخت و انتشار کالای فیزیکی

این Spec برش عمودی ساخت، ویرایش، پیش‌نمایش و انتشار کالای فیزیکی در نسخه اول
سوو است. قراردادهای مشترک را تکرار نمی‌کند و برای مالک، نسخه و dependency آن‌ها به
[گراف قراردادها و وابستگی‌های نسخه اول](../architecture/v1-contract-dependency-graph.md)
ارجاع می‌دهد.

ورودی‌های قطعی این سند:

- [نمونه تجربه ساخت کالای ساده و چندگونه](https://github.com/Mahaan-Amr/sevomart/issues/51)
- [تثبیت قرارداد کالای فیزیکی، گونه و انتشار عمومی](https://github.com/Mahaan-Amr/sevomart/issues/56)
- [تعیین مرز سه Spec و گراف قراردادها برای کار موازی](https://github.com/Mahaan-Amr/sevomart/issues/60)
- [سیستم طراحی پایه محصول](../product/design-system.md)
- [مشخصات محصول نسخه اول](mvp-product-spec.md)

## ۱. نتیجه و کار اصلی

فروشنده یک کالای فیزیکی ساده یا چندگونه را در چهار قدم کوتاه می‌سازد، نتیجه را
همان‌طور که خریدار خواهد دید پیش‌نمایش می‌کند و با یک اقدام روشن منتشر می‌کند؛
بدون آنکه پیش‌نویس ناقص یا ویرایش منتشرنشده به خریدار نشان داده شود.

- **برای فروشنده:** ادامه و بازگشت میان «مشخصات»، «تصویرها»، «فروش» و «بازبینی»
  داده ثبت‌شده را حفظ می‌کند. خطا کنار تصمیم مربوط دیده می‌شود و بازبینی دقیقاً
  قدم بعدی لازم را نشان می‌دهد.
- **برای خریدار:** فقط آخرین نسخه منتشرشده، قیمت جاری و دسترس‌پذیری authoritative
  دیده می‌شود. نسخه کاری، SKU، مقدار دقیق موجودی و گونه بازنشسته هرگز عمومی نیست.

عمق این برش پشت دو interface مالک قرار می‌گیرد: `ProductAuthoring.v1` همه قواعد
نسخه و انتشار کالا را پنهان می‌کند و `InventoryAuthoring.v1` تنها seam تغییر مقدار
موجودی است. رابط فروشنده و مصرف‌کنندگان دیگر این قواعد را دوباره پیاده نمی‌کنند.

## ۲. محدوده و خارج از محدوده

### در محدوده

- ساخت و فهرست کالای فیزیکی فروشگاه؛
- نسخه کاری کامل و قابل ذخیره برای کالای ناقص؛
- نام، توضیح، تصویرهای مرتب، صفر تا دو محور انتخاب و ۱ تا ۵۰ گونه؛
- یک مدل دسته‌خنثی که کالای ساده را با یک گونه و ترکیب خالی نمایش می‌دهد؛
- قیمت و SKU گونه، موجودی مستقل گونه و اصلاح batch هرکدام؛
- preview خصوصی، انتشار نخست، انتشار ویرایش بعدی، توقف انتشار و بازانتشار؛
- بازنشستگی گونه و discard محدود پیش‌نویس هرگزمنتشرنشده؛
- فهرست و جزئیات عمومی کالا برای فروشگاه منتشرشده؛
- upload خصوصی تصویر محصول و دسترسی عمومی مشتق‌ها از راه قرارداد رسانه؛
- رخدادهای انتشار، توقف انتشار، قیمت و عبور دسترس‌پذیری از مرز صفر؛
- معیارهای آزمون و برش‌های کوچک اجرای بعدی.

### خارج از محدوده

- کالای دیجیتال یا خدمات، مدل دسته‌محور hard-coded و قالب‌های تخصصی دسته‌بندی؛
- تخفیف، قیمت زمان‌بندی‌شده، قیمت عمده، ارز دیگر، مالیات یا چندانبار؛
- import گروهی، اتصال اینستاگرام، barcode، تولید SKU و مدیریت تأمین‌کننده؛
- crop یا ویرایش تصویر، ویدیو، CDN اختصاصی یا انتخاب provider نهایی object storage؛
- حذف کالای یک‌بارمنتشرشده یا واگذاری دوباره SKU و `variantId`؛
- رزرو و مصرف موجودی، سبد، سفارش و پرداخت؛ این رفتارها متعلق به Spec خرید هستند؛
- ranking فید، دنبال‌کردن و projection کشف؛ این برش فقط رخدادهای ورودی آن‌ها را
  تولید می‌کند؛
- آمار بازدید، پسند یا سیگنال محبوبیت عمومی؛
- تغییر composer مرکزی OpenAPI، generator/datasource مرکزی Prisma یا barrel
  مشترک قراردادها در Issueهای این مسیر.

## ۳. واژگان، actorها و مجوز

واژگان این سند همان `CONTEXT.md` است: «کالای فیزیکی»، «کالای ساده»، «گونه کالا»،
«نسخه کاری کالا»، «نسخه منتشرشده کالا»، «توقف انتشار کالا»، «گونه بازنشسته»،
«فروشنده»، «فروشندگی»، «عضویت فروشگاه» و «فضای کار فروشنده».

### actorها و audience

| actor           | audience و دسترسی                                     | نتیجه نبودن مجوز                                                       |
| --------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| مهمان یا خریدار | فقط endpoint عمومی فروشگاه و کالای منتشرشده           | منبع غیرعمومی یا فروشگاه غیرمنتشرشده `404`                             |
| فروشنده مالک    | نشست فروشنده، فروشندگی فعال و عضویت مالک همان فروشگاه | نشست نامعتبر `401`، فروشندگی غیرفعال `403`، منبع فروشگاه دیگر `404`    |
| worker داخلی    | پردازش outbox و مشتق رسانه با credential داخلی محدود  | credential نامعتبر `401/403`؛ داده محصول فروشنده دیگر قابل خواندن نیست |

- `identityId` و audience از `ActorContext.v1` می‌آید. `sellerId`، `storeId` یا
  مالکیت از body و query پذیرفته نمی‌شود.
- هر write وضعیت زنده فروشندگی و عضویت فروشگاه را از `SellerAccess.v1` و
  `StoreAuthoritativeRead.v1` دوباره بررسی می‌کند؛ اعتبار session به‌تنهایی کافی
  نیست.
- فهرست و شناسه منابع متعلق به فروشگاه دیگر `404` می‌دهند تا وجود آن‌ها افشا
  نشود. `403` فقط برای actor شناخته‌شده‌ای است که جایگاه لازم برای فضای فروشنده را
  ندارد.
- endpoint عمومی برای `DRAFT`، `UNPUBLISHED`، کالای فروشگاه غیرمنتشرشده یا گونه
  بازنشسته `404` می‌دهد.

## ۴. جریان اصلی و شکست‌ها

### ۴.۱ ساخت قدم‌به‌قدم

1. فروشنده «ساخت کالا» را آغاز می‌کند. `POST /v1/seller/products` یک
   `productId`، نسخه کاری خالی با `revision: 0` و وضعیت `DRAFT` می‌سازد.
2. در **مشخصات** نام و توضیح ثبت می‌شود. پرسش «یک کالا» یا «چندگونه» فقط شکل
   ورود داده را تعیین می‌کند؛ هر دو به مدل گونه یکسان می‌رسند.
3. در **تصویرها** فروشنده ۱ تا ۶ تصویر متعلق به همان کالا بارگذاری و مرتب می‌کند.
   تصویر نخست اصلی است. upload و مشتق‌ها از `ProductImageMedia.v1` می‌آیند و اصل
   خصوصی می‌ماند.
4. در **فروش** کالای ساده یک گونه با ترکیب خالی دارد. کالای چندگونه صفر تا دو
   محور و ترکیب‌های فعال آن‌ها را دارد. پیش از ساخت ترکیب‌ها تعداد نهایی نشان داده
   می‌شود و بیش از ۵۰ رد می‌شود.
5. قیمت تومان در UI به ریال صحیح در مرز client تبدیل می‌شود. قیمت و SKU نزد کالا
   و مقدار مقصد موجودی نزد موجودی ثبت می‌شوند. برای `variantId` تازه، provision
   موجودی صفر retry-safe است؛ مقدار واردشده با دلیل `INITIAL_STOCK` و
   `expectedRevision` به موجودی فرستاده می‌شود.
6. هر خروج از قدم، `PUT` کامل نسخه کاری را با `expectedRevision` و
   `Idempotency-Key` ذخیره می‌کند. عقب‌رفتن داده را پاک نمی‌کند.
7. در **بازبینی** preview خصوصی از همان نسخه کاری همراه قیمت و موجودی جاری ساخته
   می‌شود. نقص‌ها به قدم و path ورودی لینک می‌شوند.
8. اقدام واحد «انتشار کالا» پس از تأیید فروشنده، نسخه کاری معتبر را اتمیک منتشر،
   `publicationVersion` را زیاد و رخداد outbox را ثبت می‌کند. نتیجه عمومی می‌تواند
   بی‌درنگ از query authoritative خوانده شود؛ projection فید eventual است.

### ۴.۲ ویرایش کالای منتشرشده

- ویرایش مشخصات، تصویرها، محور یا ساختار گونه‌ها فقط نسخه کاری تازه را تغییر
  می‌دهد. تا انتشار بعدی، خریدار نسخه منتشرشده قبلی را بدون تغییر می‌بیند.
- قیمت یا SKU گونه منتشرشده از عملیات batch مستقل تغییر می‌کند، all-or-nothing
  است و پیش از اعمال تأیید صریح فروشنده می‌خواهد. قیمت تازه فوراً authoritative
  است و نسخه محتوایی را زیاد نمی‌کند.
- قیمت/SKU گونه تازه تا انتشار آن گونه عمومی نیست.
- حذف گونه یک‌بارمنتشرشده از نسخه بعدی آن را بازنشسته می‌کند؛ هویت و ارجاع
  تاریخی آن می‌ماند و SKU آن هرگز دوباره واگذار نمی‌شود.
- توقف انتشار، خرید تازه و مشاهده عمومی را قطع می‌کند اما نسخه‌ها، گونه‌ها،
  رسانه‌ها و ارجاع سفارش تاریخی را حذف نمی‌کند. بازانتشار همان `productId` را
  حفظ می‌کند و `publicationVersion` تازه می‌سازد.

### ۴.۳ شکست و بازیابی

| وضعیت                          | رفتار سیستم                                                                         | پیام و قدم بعدی رابط                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| نسخه کاری ناقص                 | ذخیره مجاز؛ انتشار با `PUBLICATION_NOT_READY` رد می‌شود                             | نقص‌ها در بازبینی و کنار قدم مرتبط؛ «این بخش را کامل کنید»            |
| `expectedRevision` قدیمی       | write کامل با `REVISION_CONFLICT` رد می‌شود و چیزی تغییر نمی‌کند                    | نسخه تازه خوانده و تفاوت‌ها نشان داده می‌شود؛ overwrite خام مجاز نیست |
| replay همان کلید و payload     | همان status/body قبلی، بدون نسخه یا رخداد تازه                                      | نتیجه قبلی نمایش داده می‌شود                                          |
| همان کلید با payload متفاوت    | `IDEMPOTENCY_CONFLICT`                                                              | درخواست تازه فقط با کلید تازه پس از تأیید کاربر                       |
| timeout پاسخ write             | client همان payload و همان کلید را retry می‌کند                                     | تا پاسخ قطعی، اقدام تکراری یا optimistic success نشان داده نمی‌شود    |
| خطای یک ردیف batch             | کل batch رد و همه ردیف‌های مسئله‌دار در `details.issues[]` برمی‌گردند               | هر ردیف با `variantId` یا `clientKey` مشخص می‌شود                     |
| تصویر ناآماده یا بی‌مالک       | انتشار با `PUBLICATION_NOT_READY` یا `MEDIA_NOT_OWNED` رد می‌شود                    | وضعیت پردازش/تعویض تصویر و اقدام دوباره روشن است                      |
| فروشگاه غیرمنتشرشده            | نخستین انتشار با `STORE_NOT_PUBLISHED` رد می‌شود                                    | «ابتدا فروشگاه را منتشر کنید» با مسیر همان کار                        |
| توقف فروشندگی میان مراحل       | write بعدی `403`؛ نسخه قبلی حفظ می‌شود                                              | دلیل عدم دسترسی و مسیر پیگیری، بدون ادعای حذف داده                    |
| projection فید stale           | query عمومی authoritative درست می‌ماند؛ consumer نسخه قدیمی را نادیده می‌گیرد       | رابط ساخت موفقیت را به حضور فوری در فید گره نمی‌زند                   |
| شکست object storage            | metadata نهایی نمی‌شود یا asset در وضعیت خطا می‌ماند؛ transaction کالا باز نمی‌ماند | retry upload؛ تصویر ناقص قابل انتشار نیست                             |
| رخداد زودرس offer/availability | consumer تا رسیدن snapshot همان publication نگه می‌دارد                             | اثری بر پاسخ authoritative ندارد                                      |

## ۵. state، invariant و transaction

### ۵.۱ وضعیت کالا و نسخه‌ها

```text
DRAFT --publish--> PUBLISHED --unpublish--> UNPUBLISHED
   |                    ^                       |
   +--discard           +------ publish -------+

PUBLISHED --publish working copy--> PUBLISHED (publicationVersion + 1)
```

- `discard` فقط برای `DRAFT` هرگزمنتشرنشده و بدون ارجاع مجاز است.
- `PUBLISHED` با ایجاد نسخه کاری تازه همچنان عمومی است و نسخه منتشرشده قبلی را
  ارائه می‌کند.
- `UNPUBLISHED` عمومی نیست؛ ویرایش و preview خصوصی آن مجاز است.
- هر انتشار snapshot تغییرناپذیر محتوای همان `publicationVersion` می‌سازد.
  قیمت، SKU جاری و موجودی جزو snapshot محتوایی نیستند.

### ۵.۲ invariantهای کالا و گونه

- هر کالا دقیقاً به یک فروشگاه تعلق دارد و ۱ تا ۵۰ گونه جاری دارد.
- کالای ساده دقیقاً یک گونه با `combination: {}` دارد؛ endpoint یا جدول جدا ندارد.
- نام پس از trim بین ۲ تا ۱۲۰ نویسه و توضیح اختیاری حداکثر ۲۰۰۰ نویسه است.
- نسخه قابل انتشار ۱ تا ۶ `mediaId` یکتا دارد و تصویر اول اصلی است.
- کالا صفر تا دو محور دارد. نام محور و مقدار پس از trim و یکسان‌سازی فاصله در
  همان کالا یکتا است.
- هر ترکیب فعال یکتا است؛ هر مقدار باقی‌مانده دست‌کم در یک گونه استفاده می‌شود.
- `variantId` یک UUID پایدار پلتفرم است. ترکیب یکسان در ویرایش هویت قبلی را حفظ
  می‌کند؛ ترکیب تازه هویت تازه می‌گیرد.
- SKU اختیاری، پس از trim و بدون نویسه کنترلی، در کل تاریخ فروشگاه یکتا است.
  ویرایش SKU مجاز است اما مقدار آزادشده دوباره قابل واگذاری نیست.
- `Money.v1` برای قیمت: عدد صحیح ریال، `currency: IRR`، مثبت، مضرب ۱۰ و حداکثر
  `Number.MAX_SAFE_INTEGER`. UI فقط تومان می‌گیرد و تبدیل دقیق را می‌آزماید.
- بازه قیمت عمومی از همه گونه‌های جاری نسخه منتشرشده، مستقل از موجودی، محاسبه
  می‌شود.

### ۵.۳ invariantهای موجودی و دسترس‌پذیری

- مقدار موجودی integer نامنفی و فقط در ماژول موجودی منبع حقیقت است.
- ساخت `variantId` و provision موجودی صفر برای همان شناسه از دید client اتمیک و
  retry-safe است.
- اصلاح موجودی مقدار مقصد، دلیل و `expectedRevision` دارد؛ delta بی‌ردپا یا write
  مستقیم از ماژول کالا ممنوع است.
- batch موجودی all-or-nothing است. هر تعارض revision کل batch را رد می‌کند.
- کالا `AVAILABLE` است اگر دست‌کم یک گونه جاری موجودی مثبت داشته باشد؛ وگرنه
  `OUT_OF_STOCK` است. مقدار مثبت شرط انتشار نیست.
- بازنشستگی گونه رزرو تازه را رد می‌کند، اما رزرو اتمیک قبلی را تغییر نمی‌دهد.
  چرخه رزرو در Spec خرید تعریف می‌شود.

### ۵.۴ مرز transaction و consistency

- `PUT` نسخه کاری، ساخت هویت گونه تازه و provision صفر موجودی با transaction
  context مات در یک transaction PostgreSQL انجام می‌شود. caller به repository یا
  جدول داخلی دسترسی ندارد.
- انتشار، ساخت snapshot منتشرشده، افزایش `publicationVersion`، بازنشستگی گونه‌های
  حذف‌شده و درج `ProductPublished.v2` در outbox اتمیک‌اند.
- توقف انتشار، تغییر state و outbox همان رخداد اتمیک‌اند.
- batch قیمت/SKU در transaction کالا و batch موجودی در transaction موجودی مستقل
  و all-or-nothing هستند؛ UI آن‌ها را transaction توزیع‌شده معرفی نمی‌کند.
- تماس object storage بیرون transaction پایگاه داده است. فقط asset پردازش‌شده و
  متعلق به همان کالا وارد نسخه قابل انتشار می‌شود.
- outbox حداقل یک‌بار تحویل می‌دهد. consumer با `eventId` idempotent، با sequence
  مرتب و نسبت به نسخه قدیمی بی‌اثر است.

## ۶. قراردادهای تولیدی

این بخش interfaceهای متعلق به کالا و موجودی را تعریف می‌کند و با
[ردیف‌های canonical کالا و موجودی](../architecture/v1-contract-dependency-graph.md#جدول-canonical)
یک قرارداد واحد دارد. artifactها از `@sevo/contracts/product/v1` و
`@sevo/contracts/inventory/v1` منتشر می‌شوند.

### ۶.۱ `ProductAuthoring.v1`

همه عملیات زیر sync، strong، بدون PII و برای فروشنده مالک‌اند. writeها
`Idempotency-Key` می‌خواهند؛ تغییر منبع موجود `expectedRevision` نیز می‌خواهد.

| operationId و route                                                              | ورودی اصلی                                        | خروجی و اثر                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `createSellerProduct` — `POST /v1/seller/products`                               | کلید idempotency                                  | `productId`، state و working copy خالی                           |
| `listSellerProducts` — `GET /v1/seller/products`                                 | cursor، limit و فیلتر state اختیاری               | صفحه پایدار از خلاصه خصوصی؛ بدون آمار محبوبیت                    |
| `getSellerProduct` — `GET /v1/seller/products/{productId}`                       | شناسه از path                                     | state، نسخه کاری، نسخه انتشار و revisionها                       |
| `replaceProductWorkingCopy` — `PUT /v1/seller/products/{productId}/working-copy` | snapshot کامل، `expectedRevision`                 | نسخه کاری canonical و mapping هر `clientKey` تازه به `variantId` |
| `previewSellerProduct` — `GET /v1/seller/products/{productId}/preview`           | شناسه                                             | projection خصوصی خریدارنما و `issues[]` readiness                |
| `publishSellerProduct` — `POST /v1/seller/products/{productId}/publications`     | `expectedRevision` و تأیید صریح                   | state، `publicationVersion` و خلاصه عمومی                        |
| `unpublishSellerProduct` — `POST /v1/seller/products/{productId}/unpublication`  | `expectedRevision` و reason code                  | state `UNPUBLISHED`                                              |
| `discardSellerProductDraft` — `DELETE /v1/seller/products/{productId}`           | `expectedRevision`                                | `204` فقط برای draft مجاز                                        |
| `replaceVariantOffersBatch` — `PUT /v1/seller/products/{productId}/offers`       | ردیف‌های `variantId`، price، SKU و offer revision | نتیجه تمام ردیف‌ها یا رد کامل batch                              |

snapshot نسخه کاری شامل `name`، `description`، `orderedMediaIds`، `axes` و
`variants` است. هر گونه موجود `variantId` و هر گونه تازه `clientKey` پایدار همان
client دارد. برای گونه تازه، قیمت/SKU اولیه در snapshot می‌آید؛ قیمت/SKU گونه
منتشرشده فقط از batch offer تغییر می‌کند. پاسخ canonical whitespace و ترتیب محورها
و مقدارها را قطعی برمی‌گرداند.

### ۶.۲ `ProductAuthoritativeRead.v1`

| operationId و route/interface                                                  | caller         | تضمین                                                                           |
| ------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------- |
| `listPublishedStoreProducts` — `GET /v1/stores/{storeSlug}/products`           | مهمان و خریدار | cursor پایدار، خلاصه آخرین publication و قیمت/availability جاری                 |
| `getPublishedStoreProduct` — `GET /v1/stores/{storeSlug}/products/{productId}` | مهمان و خریدار | جزئیات authoritative، تصویرهای مرتب، محور/مقدار، گونه جاری و offer/availability |
| `readSellableVariants` — interface درون‌پردازه‌ای نسخه‌دار                     | سبد و سفارش    | قیمت و امکان فروش strong برای `productId/variantIds` در همان لحظه               |

خلاصه عمومی فقط `productId`، نام، تصویر اصلی، بازه قیمت، availability و
`publicationVersion` دارد. جزئیات توضیح، مشتق‌های مرتب، محورها و گونه‌های جاری با
قیمت و availability را اضافه می‌کند. SKU، تعداد دقیق موجودی، working revision و
گونه بازنشسته در هیچ پاسخ عمومی نیست.

### ۶.۳ `InventoryAuthoring.v1` و `InventoryAvailabilityRead.v1`

| operationId و route/interface                          | ورودی                                                    | خروجی و تضمین                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `listSellerInventory` — `GET /v1/seller/inventory`     | cursor، limit، فیلتر availability اختیاری                | گونه، عنوان نمایشی کالا، مقدار دقیق و revision؛ فقط مالک                        |
| `replaceInventoryBatch` — `PUT /v1/seller/inventory`   | `variantId`، مقدار مقصد، reason code، `expectedRevision` | نتیجه all-or-nothing و revision تازه                                            |
| `provisionVariantInventory` — interface درون‌پردازه‌ای | `variantId/storeId` و transaction context مات            | ردیف صفر idempotent؛ فقط کالا caller است                                        |
| `readVariantAvailability` — interface درون‌پردازه‌ای   | `variantIds`                                             | مقدار قابل‌فروش و revision strong؛ پاسخ عمومی فقط availability مشتق‌شده می‌گیرد |

reason codeهای authoring نسخه اول `INITIAL_STOCK`، `MANUAL_COUNT`،
`DAMAGED`، `RETURNED_TO_STOCK` و `CORRECTION` هستند. توضیح انسانی اختیاری فقط در
audit خصوصی نگهداری می‌شود و وارد event یا log نمی‌شود.

### ۶.۴ خطاهای مالک

همه خطاها `ErrorEnvelope.v1` با `code/message/correlationId/details` هستند.
`message` fallback است و UI از `code/details` متن فارسی می‌سازد. خطای ورودی
`details.issues[]` با `path` پایدار و در ردیف گونه با `variantId` یا `clientKey`
برمی‌گردد.

| code                    | HTTP | معنا                                                             |
| ----------------------- | ---: | ---------------------------------------------------------------- |
| `REVISION_CONFLICT`     |  409 | revision کالا، offer یا موجودی قدیمی است                         |
| `IDEMPOTENCY_CONFLICT`  |  409 | کلید قبلی با payload متفاوت استفاده شده است                      |
| `PUBLICATION_NOT_READY` |  422 | یک یا چند invariant انتشار برقرار نیست                           |
| `INVALID_VARIANT`       |  422 | ترکیب، هویت یا چرخه گونه نامعتبر است                             |
| `DUPLICATE_COMBINATION` |  422 | دو گونه ترکیب canonical یکسان دارند                              |
| `DUPLICATE_SKU`         |  409 | SKU در تاریخ فروشگاه استفاده شده است                             |
| `MEDIA_NOT_OWNED`       |  422 | رسانه متعلق به فروشنده/کالای جاری نیست                           |
| `STORE_NOT_PUBLISHED`   |  409 | نخستین انتشار پیش از انتشار فروشگاه درخواست شده است              |
| `INVALID_TRANSITION`    |  409 | publish، unpublish، discard یا بازنشستگی در state جاری مجاز نیست |
| `PRODUCT_NOT_FOUND`     |  404 | کالا وجود ندارد یا برای actor قابل مشاهده نیست                   |
| `INVENTORY_NOT_FOUND`   |  404 | گونه برای فروشگاه جاری قابل مدیریت نیست                          |

### ۶.۵ رخدادها

هر رخداد `EventEnvelope.v1` با `eventId`، aggregate id/sequence، `occurredAt`،
`correlationId` و `causationId` دارد، فاقد PII است و همراه تغییر مالک در outbox
ثبت می‌شود.

| رخداد                           | payload دامنه‌ای حداقلی                                                                                  | version ordering                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `ProductPublished.v2`           | `storeId`، `productId`، `publicationVersion`، `snapshot.variantIds` و offer/availability versionهای همراه  | نسخه canonical؛ خواندن محتوا از producer                      |
| `ProductUnpublished.v1`         | `storeId`، `productId`، `publicationVersion`                                                             | sequence کالا                                  |
| `VariantPriceChanged.v1`        | `storeId`، `productId`، `variantId`، `offerVersion`، price و `publicationVersion` مرتبط                  | offerVersion مستقل                             |
| `VariantAvailabilityChanged.v1` | `storeId`، `productId`، `variantId`، `availabilityVersion`، `AVAILABLE/OUT_OF_STOCK` و publication مرتبط | فقط عبور از مرز صفر؛ availabilityVersion مستقل |

رخداد قیمت یا availability می‌تواند زودتر از snapshot انتشار برسد؛ consumer آن
را تا دریافت publication مرتبط نگه می‌دارد. تغییر ناسازگار schema با `.v2` کنار
`.v1` عرضه، مصرف‌کنندگان مهاجرت و سپس نسخه قدیمی حذف می‌شود. افزودن optional
سازگار در v1 مجاز است.

### ۶.۶ تثبیت مالکیت و سازگاری رخدادها

طبق [تثبیت قراردادهای مشترک و ترتیب migrationها برای کار موازی](https://github.com/Mahaan-Amr/sevomart/issues/110)،
نسخه canonical انتشار `ProductPublished.v2` است. snapshot رخداد تنها شناسه گونه‌ها
را حمل می‌کند؛ متن، تصویر، قیمت نمایشی و تعداد دقیق موجودی از رخداد انتشار خوانده
نمی‌شوند. مصرف‌کننده برای نمایش، خواندن authoritative کالا و موجودی را به کار می‌برد.
قرارداد `ProductPublished.v1` فقط در پنجره سازگاری و adapter تاریخچه discovery
باقی می‌ماند؛ حذف آن نیازمند اثبات نبود مصرف‌کننده و نیاز replay است.

schema و emission رخداد `VariantAvailabilityChanged.v1` فقط متعلق به inventory
است. کالا در فرمان اصلاح موجودی، شناسه کالا و نسخه انتشار را می‌دهد؛ inventory
پس از قفل‌کردن موجودی، عبور `onHand - reserved` از مرز صفر را تشخیص می‌دهد و
رخداد را همراه mutation در همان تراکنش ثبت می‌کند. محصول رخداد موجودی نمی‌سازد.
شرح سطح اجرایی، پنجره سازگاری و شواهد در
[تحویل قرارداد کالا و موجودی](../delivery/product-inventory-contracts.md) آمده است.

## ۷. قراردادهای مصرفی و یال‌ها

تعریف schema و invariant موارد زیر فقط نزد producer می‌ماند. این Spec adapter یا
fake لازم را در seam مصرف ثبت می‌کند و قرارداد را محلی بازنویسی نمی‌کند.

| قرارداد canonical مصرفی                                                                 | نوع یال                                    | fake مجاز در ساخت                                      | شرط حذف fake و بازشدن integration/E2E                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------- |
| platform: typed IDs، `Money.v1`، `Timestamp.v1`، `ErrorEnvelope.v1`، `EventEnvelope.v1` | `contract-blocks`                          | خیر                                                    | baseline قرارداد و entrypoint نسخه‌دار ادغام شده باشد         |
| هویت: `IdentitySession.v1` و `ActorContext.v1`                                          | `contract-blocks`                          | فقط test adapter همان قرارداد                          | resolver واقعی نشست و audience در API فعال باشد               |
| هویت: `SellerAccess.v1`                                                                 | `contract-blocks` سپس `integration-blocks` | seller فعال/تعلیق‌شده در حافظه                         | اعطا و بررسی زنده فروشندگی با integration واقعی سبز باشد      |
| فروشگاه: `StoreAuthoritativeRead.v1`                                                    | `contract-blocks` سپس `integration-blocks` | فروشگاه مالک با state منتشر/منتشرنشده                  | query عضویت و state واقعی فروشگاه در انتشار و E2E استفاده شود |
| رسانه: `ProductImageMedia.v1`                                                           | `contract-blocks` سپس `integration-blocks` | adapter درون‌حافظه‌ای asset آماده/درحال‌پردازش/بی‌مالک | upload خصوصی، ownership و مشتق عمومی واقعی در E2E سبز باشد    |

- routeهای مصرفی رسانه را مالک رسانه در OpenAPI fragment خودش تعریف می‌کند:
  `createProductImageUpload` روی
  `POST /v1/seller/products/{productId}/images` با `Idempotency-Key`،
  `getProductImageProcessingStatus` روی
  `GET /v1/seller/products/{productId}/images/{mediaId}` و تحویل مشتق عمومی
  با URL/route کوتاه‌عمر متعلق به همان قرارداد. ترتیب و حذف ارجاع تصویر فقط با
  `replaceProductWorkingCopy` تغییر می‌کند؛ حذف بایت یا metadata عملیات کالا نیست.
- contract هر ردیف باید پیش از شروع caller تثبیت باشد. fake فقط implementation
  adapter را جایگزین می‌کند و شکل interface یا خطا را تغییر نمی‌دهد.
- integration با هویت، فروشگاه و رسانه تا اجرای producer واقعی blocked است؛ unit
  و contract test کالا می‌تواند از adapterهای بالا استفاده کند.
- کالا producer قراردادهای authoritative و رخداد برای checkout و فید است. آن
  مسیرها می‌توانند با fake شروع شوند، اما fake خود را پس از integration این Spec
  حذف می‌کنند؛ این Spec schema مصرف‌کننده آن‌ها را مالک نیست.

## ۸. مالکیت داده، فایل و migration

### ۸.۱ مالکیت داده

| ماژول  | داده تحت مالکیت                                                                                                                              | داده‌ای که نگه نمی‌دارد                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| کالا   | product، working/publication snapshot، axis/value، variant identity/lifecycle، offer/SKU history، publication state و idempotency scope خودش | مقدار موجودی، session، عضویت فروشگاه، بایت/metadata رسانه یا projection فید |
| موجودی | مقدار on-hand، revision، adjustment audit، reservation lifecycle و idempotency scope خودش                                                    | قیمت، SKU، متن/تصویر کالا یا snapshot سفارش                                 |
| رسانه  | asset metadata، ownership، processing state، checksum و object keys                                                                          | معنای انتشار کالا یا state محصول؛ فقط policy دسترسی فنی را اعمال می‌کند     |

منبع حقیقت عملیاتی کالا و موجودی projection مشترک ندارد. query عمومی کالا
availability را از `InventoryAvailabilityRead.v1` می‌گیرد و می‌تواند نتیجه مشتق
کوتاه‌عمر cache کند، اما cache اجازه تصمیم رزرو یا سفارش نیست.

### ۸.۲ خانواده فایل‌های Issueهای ساخت

| مالک موقت           | خانواده فایل مجاز                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| کالا backend        | `apps/api/src/modules/product/**`                                                                     |
| موجودی backend      | `apps/api/src/modules/inventory/**`                                                                   |
| قرارداد کالا        | entrypoint ازپیش‌آماده `packages/contracts/src/product/v1/**`                                         |
| قرارداد موجودی      | entrypoint ازپیش‌آماده `packages/contracts/src/inventory/v1/**`                                       |
| OpenAPI کالا/موجودی | fragment و operations slot همان ماژول زیر `apps/api/src/openapi/**`                                   |
| schema کالا         | فایل ماژول‌محور Prisma کالا پس از baseline                                                            |
| schema موجودی       | فایل ماژول‌محور Prisma موجودی پس از baseline                                                          |
| migration           | `packages/database/prisma/migrations/<timestamp>__product__*` یا `__inventory__*`؛ یک مالک در هر زمان |
| رابط فروشنده کالا   | `apps/web/src/app/(seller)/seller/products/**` و lib اختصاصی همان مسیر                                |
| رابط عمومی کالا     | `apps/web/src/app/(buyer)/**` فقط در Issue ادغام فروشگاه عمومی                                        |
| worker رخداد        | handler اختصاصی product/inventory در `apps/worker/src/**` بدون تغییر bootstrap مرکزی هم‌زمان          |

فایل‌های مرکزی `packages/contracts/package.json`، barrel مشترک، Prisma
generator/datasource، OpenAPI composer، `app.module.ts` و worker bootstrap فقط در
baseline یا Issue ادغام تک‌مالک تغییر می‌کنند. slot لازم باید پیش از fan-out ساخته
شود؛ Issue دامنه composer یا barrel برخوردپذیر را ویرایش نمی‌کند.

## ۹. PII، حریم خصوصی و observability

- commandهای این Spec فقط شناسه‌های typed، محتوای کالا، SKU خصوصی، قیمت و مقدار
  موجودی می‌گیرند. شماره موبایل، token، مقصد تسویه، نشانی یا داده بانکی جایی در
  قرارداد کالا و موجودی ندارد.
- نام و توضیح کالا متن عمومی بالقوه‌اند، اما تا انتشار خصوصی می‌مانند. اصل تصویر
  همیشه خصوصی است؛ فقط مشتق asset ارجاع‌شده در publication جاری قابل تحویل عمومی
  است.
- SKU، موجودی دقیق، working copy، reason text اصلاح موجودی، revisionهای داخلی و
  گونه بازنشسته فقط برای فروشنده مالک/عملیات مجازند.
- upload خصوصی متصل به working copy حفظ می‌شود. upload متصل‌نشده پس از ۲۴ ساعت
  توسط cleanup رسانه قابل حذف است؛ حذف بایت نباید ارجاع publication جاری را بشکند.
- event، projection عمومی، log، trace و metric نباید SKU، مقدار دقیق موجودی، نام
  یا توضیح کالا، URL امضاشده، object key، token، payload خام، reason text یا
  metadata خام provider را حمل کنند. fixture واقعی فروشنده ممنوع است.
- هر request و event `correlationId` دارد؛ retry همان idempotency record را قابل
  ردیابی می‌کند. audit خصوصی actor id، operation، aggregate id، revision پیش/پس،
  reason code و زمان را نگه می‌دارد، نه token یا متن حساس.

metricهای حداقلی:

- latency و نرخ خطا بر اساس `operationId/code`، بدون route parameter؛
- شمار conflictهای revision/idempotency و batch reject؛
- زمان پردازش تصویر و شمار assetهای stuck؛
- lag و retry outbox برای هر event type؛
- lag projection نسبت به `publicationVersion/offerVersion/availabilityVersion`؛
- شمار انتشار/توقف انتشار عملیاتی؛ این metric آمار عمومی محبوبیت نیست.

alert برای افزایش پایدار خطای انتشار، asset پردازش‌نشده فراتر از مهلت، outbox lag،
شکست cleanup و واگرایی projection version لازم است. مقدار threshold پس از baseline
محیط و بار نمونه تعیین می‌شود و بخشی از متن بازاریابی نیست.

## ۱۰. معیار پذیرش و برش Issueها

### ۱۰.۱ معیار پذیرش خودکار و تجربه

#### Unit در interface ماژول

- کالای ساده با یک گونه و ترکیب خالی و کالای چندگونه با دو محور از یک مدل عبور
  می‌کنند؛ ترکیب تکراری، مقدار یتیم و بیش از ۵۰ گونه رد می‌شود.
- canonicalization نام محور/مقدار و SKU، عدم استفاده مجدد SKU و حفظ `variantId`
  ترکیب یکسان آزموده می‌شود.
- state transitionهای publish/unpublish/republish/discard و باقی‌ماندن publication
  قبلی هنگام working copy تازه پوشش دارند.
- Money ریال و تبدیل دقیق تومان، مرز safe integer، مضرب ۱۰ و مقدار نامعتبر آزموده
  می‌شوند.
- availability از موجودی گونه‌های جاری و بازه قیمت مستقل از موجودی محاسبه می‌شود.
- replay، conflict payload، revision conflict و رد all-or-nothing هر دو batch
  آزموده می‌شوند.

#### Integration با PostgreSQL واقعی

- ذخیره working copy، ساخت variant و provision صفر در یک transaction و در rollback
  کامل آزموده می‌شوند.
- publication snapshot، افزایش version، بازنشستگی و outbox اتمیک‌اند.
- هم‌زمانی دو write و دو batch فقط یک نتیجه معتبر می‌دهد و oversell/عدد منفی از
  مسیر authoring ممکن نیست.
- uniqueness تاریخی SKU در فروشگاه و جداسازی مالکیت دو فروشگاه در database enforce
  می‌شود.
- query عمومی draft/unpublished/فروشگاه غیرمنتشرشده `404` و query فروشنده دیگر نیز
  `404` می‌دهد.

#### Contract و compatibility

- OpenAPI همه operationIdها، headerهای idempotency/revision، error codeها، cursor و
  schemaهای عمومی/خصوصی جدا را golden-test می‌کند.
- schema رخدادها با envelope مشترک validate و replay/out-of-order با consumer fake
  آزموده می‌شود.
- افزودن سازگار v1 و رد breaking change بدون v2 در CI بررسی می‌شود.
- adapter fake و واقعی هویت، فروشگاه و رسانه یک suite مشترک interface را پاس
  می‌کنند.

#### E2E و دسترس‌پذیری

- روی viewport موبایل و دسکتاپ، فروشنده کالای ساده و کالای دو‌محوره را در چهار قدم
  می‌سازد، عقب می‌رود، داده را حفظ، preview می‌کند و منتشر می‌کند.
- داده نماینده شامل یک کالای تک‌گونه، یک کالای دو‌محوره با قیمت/موجودی مستقل و یک
  گونه ناموجود است و به نام دسته خاص وابسته نیست.
- خریدار بدون ورود آخرین publication را می‌بیند؛ SKU و تعداد دقیق موجودی در DOM،
  JSON یا response عمومی نیست و گونه صفر موجودی قابل افزودن به سبد معرفی نمی‌شود.
- ویرایش working copy نسخه عمومی را تغییر نمی‌دهد؛ batch قیمت اثر فوری و توقف
  انتشار نتیجه عمومی `404` دارد.
- timeout و retry انتشار نتیجه تکراری یا دو رخداد نمی‌سازد؛ projection دیررس به
  موفقیت کاذب رابط منجر نمی‌شود.
- RTL، متن فارسی بلند، اعداد و تومان، ترتیب focus منطقی، keyboard-only برای
  مرتب‌سازی تصویر/عبور قدم‌ها، نام دسترس‌پذیر کنترل‌های آیکنی و target لمسی حداقل
  `40px` آزموده می‌شوند.
- کنتراست متن/focus/error مستقل از سایه است. در `prefers-reduced-motion: reduce`
  حرکت غیرضروری حذف و بازخورد بدون انیمیشن قابل فهم می‌ماند.
- جریان رسمی `docker compose up --build` و مسیر `pnpm dev` هر دو همان migration،
  env، upload و رفتار API را اجرا می‌کنند.

### ۱۰.۲ برش‌های کوچک پیشنهادی ساخت

این‌ها عنوان و dependency پیشنهادی‌اند، نه Issueهای ساخته یا claim‌شده. هر Issue
پس از ادغام قبلی از SHA مشترک تازه ساخته و مالک آن میان `Mahaan-Amr` و `ferpheri`
ثبت می‌شود.

| ترتیب | Issue پیشنهادی و نتیجه                                                                  | فایل/مالک موقت                                              | dependency                                                         |
| ----: | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
|     ۰ | **آماده‌سازی baseline ماژول‌محور قرارداد، Prisma، OpenAPI و outbox**                    | platform؛ فایل‌های مرکزی                                    | پیش از همه؛ تک‌مالک و ادغام‌شده روی main                           |
|     ۱ | **تثبیت artifactهای v1 کالا و موجودی**؛ schema فرمان/query/error/event و contract tests | `@sevo/contracts/product/v1` و `inventory/v1`؛ `Mahaan-Amr` | contract-blocks از baseline و قراردادهای هویت/فروشگاه/رسانه        |
|     ۲ | **ساخت هسته نسخه کاری و چرخه گونه کالا**؛ persistence، invariant و preview خصوصی        | ماژول و migration کالا؛ `Mahaan-Amr`                        | artifactهای v1؛ adapter fake هویت/فروشگاه/رسانه مجاز               |
|     ۳ | **ساخت authoring موجودی و revision ممیزی‌شده**؛ provision صفر، فهرست و batch            | ماژول و migration موجودی؛ `Mahaan-Amr`                      | artifactهای v1؛ با Issue ۲ روی schema/migration مشترک هم‌زمان نشود |
|     ۴ | **ساخت انتشار، توقف انتشار و public read کالا**؛ snapshot، outbox و رخدادها             | کالا و worker slot اختصاصی؛ `Mahaan-Amr`                    | Issueهای ۲ و ۳؛ integration واقعی فروشگاه/رسانه برای E2E           |
|     ۵ | **ساخت مسیر چهارقدمی فروشنده برای کالا**؛ مشخصات، تصویر، فروش و بازبینی                 | route و style اختصاصی web؛ `Mahaan-Amr`                     | عملیات authoring ۲ تا ۴؛ media integration واقعی                   |
|     ۶ | **ادغام کالای عمومی در فروشگاه خریدار**؛ فهرست، جزئیات و availability                   | route عمومی web؛ مالک هماهنگ با مسیر فروشگاه                | public read واقعی؛ بدون تغییر قرارداد کالا                         |
|     ۷ | **سخت‌سازی E2E، RTL و recovery ساخت و انتشار کالا**                                     | testهای مسیر و fixture دسته‌خنثی؛ یک مالک، مرور همکار       | candidate ثابت ۱ تا ۶؛ پیش از handoff به checkout/feed             |

Issueهای checkout پس از artifactهای v1 می‌توانند با fake شروع شوند، اما integration
قیمت/availability واقعی به Issueهای ۳ و ۴ وابسته است. Issue کشف پس از تثبیت schema
رخدادها با fixture شروع و integration آن پس از outbox واقعی Issue ۴ باز می‌شود.

پیش از هر برش، PR قبلی ادغام، `origin/main` دریافت، SHA پایه در Issue ثبت و
بررسی‌های مرتبط سبز می‌شود. هیچ دو شاخه‌ای هم‌زمان schema، migration، contract
entrypoint یا فایل مرکزی یکسان را تغییر نمی‌دهند.
