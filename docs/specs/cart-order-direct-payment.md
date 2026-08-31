# مشخصات سبد، سفارش و پرداخت مستقیم

وضعیت: آماده مرور و شکستن به Issueهای ساخت

مرجع اجرا:
[تدوین Spec سبد، سفارش و پرداخت مستقیم](https://github.com/Mahaan-Amr/sevomart/issues/67)

تصمیم‌های قطعی:
[نمونه تجربه سبد، ثبت سفارش و پرداخت آزمایشی](https://github.com/Mahaan-Amr/sevomart/issues/53)،
[انتخاب منبع محلی و نسخه‌دار استان‌ها و شهرهای ایران](https://github.com/Mahaan-Amr/sevomart/issues/55)،
[تثبیت قرارداد سبد، نشانی، موجودی، سفارش و پرداخت مستقیم](https://github.com/Mahaan-Amr/sevomart/issues/59)
و
[تعیین مرز سه Spec و گراف قراردادها برای کار موازی](https://github.com/Mahaan-Amr/sevomart/issues/60)

مرجع قرارداد و وابستگی:
[گراف قراردادها و وابستگی‌های نسخه اول](../architecture/v1-contract-dependency-graph.md)

## ۱. نتیجه و کار اصلی

**کار اصلی خریدار:** کالاهای یک فروشگاه را بدون ورود در سبد نگه دارد، پس از ورود
نشانی و روش ارسال را انتخاب کند، مبلغ و مسئولیت‌ها را دوباره ببیند و یک سفارش
تک‌فروشگاهی را با تسویه مستقیم ثبت و پرداخت کند.

**نتیجه قابل مشاهده:** خریدار در هر لحظه می‌داند قیمت و موجودی معتبرند یا تغییر
کرده‌اند، مبلغ برای چه کسی تسویه می‌شود، وضعیت پرداخت قطعی است یا هنوز بررسی
می‌شود و قدم بعدی چیست.

**اثر برای فروشنده:** فروشنده فقط سفارشی را می‌بیند که پرداخت آن قطعی و موجودی‌اش
دقیقاً یک‌بار مصرف شده است. سفارش منتظر، ناموفق، منقضی یا دارای پرداخت در حال
بررسی به صف اقدام فروشنده راه پیدا نمی‌کند.

مسیر خریدار صفحه‌محور و کوتاه است:

`سبد ← ورود ← نشانی و ارسال ← مرور نهایی سفارش ← پرداخت ← نتیجه`

هر صفحه فقط یک کار اصلی و یک اقدام اصلی برجسته دارد. مشاهده کالا، افزودن به سبد
و دیدن سبد به ورود وابسته نیست؛ ورود فقط هنگام ادامه برای ثبت سفارش درخواست
می‌شود.

## ۲. محدوده و خارج از محدوده

### محدوده

- سبد مهمان تک‌فروشگاهی و سروری با cookie دسترسی opaque؛
- mutation نسخه‌دار و idempotent سبد، جایگزینی صریح فروشگاه و ادغام صریح پس از
  ورود؛
- نشانی ذخیره‌شده نسخه‌دار و نشانی تحویل سفارش تغییرناپذیر؛
- روش ارسال نسخه‌دار با هزینه ثابت یا دریافت حضوری؛
- `PrepareCheckout.v1` برای بازاعتبارسنجی و `CreateOrder.v1` برای snapshot و رزرو
  ۱۵ دقیقه‌ای؛
- مبلغ صحیح ریالی، تسویه مستقیم و متن ثابت حدود مسئولیت سوو؛
- تلاش پرداخت، Provider توسعه، callback معتبر، تطبیق نتیجه مبهم و موفقیت دیررس؛
- رزرو، hold کوتاه تلاش پرداخت، مصرف یا آزادسازی موجودی از راه قرارداد مالک
  موجودی؛
- رسید و پیگیری وضعیت سفارش برای خریدار؛
- فهرست و جزئیات سفارش قابل اقدام و reveal ممیزی‌شده اطلاعات تحویل برای فروشنده؛
- OpenAPI، رخداد، idempotency، transaction، observability و failure modeهای این
  برش؛
- fakeهای قراردادی برای ساخت مستقل از پیاده‌سازی کالا، موجودی و فروشگاه.

### خارج از محدوده

- سبد چندفروشگاهی، تخفیف، مالیات، اعتبار کیف پول، rounding مستقل یا مبلغی جز
  ریال؛
- dataset استان و شهر یا fallback شبکه‌ای؛ شهر و استان متن snapshot‌شونده‌اند؛
- Provider واقعی، انتخاب درگاه، قرارداد بانکی و production readiness پرداخت؛
- پرداخت محافظت‌شده، نگهداری وجه یا تضمین بازپرداخت؛
- آماده‌سازی، ارسال، رهگیری، تحویل، لغو، مرجوعی و پرونده اختلاف؛
- تصمیم انسانی درباره نتیجه مالی مبهم؛ این مجوز همراه Provider واقعی تصمیم جدا
  می‌خواهد؛
- حذف یا retention نهایی داده مالی و نشانی و مدیریت یا چرخش کلید encryption؛
- گزارش تحلیلی، اعلان بیرونی و رابط کامل عامل پلتفرم.

وضعیت‌های لغو و بازپرداخت که در مدل کلان سفارش رزرو شده‌اند در این برش transition
قابل فراخوانی، صفحه یا Issue ساخت ندارند.

## ۳. واژگان، actorها و مجوز

واژگان این Spec از [زبان مشترک محصول](../../CONTEXT.md) می‌آیند. «سبد»، «نشانی
ذخیره‌شده»، «نشانی تحویل سفارش»، «روش ارسال»، «مرور نهایی سفارش»، «سفارش»،
«تلاش پرداخت»، «پرداخت در حال بررسی»، «تطبیق پرداخت»، «رزرو موجودی»، «مصرف
موجودی»، «تسویه مستقیم» و «سفارش قابل اقدام» معنای دیگری ندارند.

### actor و audience

| actor             | audience نشست             | مجوز در این برش                                                                               |
| ----------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| مهمان             | ندارد                     | ساخت و تغییر سبد فقط با secret همان سبد؛ مشاهده مسیر عمومی کالا و فروشگاه                     |
| خریدار            | `buyer`                   | اتصال یا حل تعارض سبد، CRUD نشانی خود، مرور نهایی، ساخت و پرداخت سفارش خود و خواندن پیگیری آن |
| فروشنده           | `seller`                  | فقط فهرست و جزئیات سفارش قابل اقدام فروشگاه دارای عضویت فعال و reveal دلیل‌دار اطلاعات تحویل  |
| worker پرداخت     | service credential داخلی  | تطبیق تلاش‌های `REVIEW_REQUIRED` از راه Provider و اعمال نتیجه معتبر                          |
| callback Provider | اعتبارسنجی‌شده در adapter | ثبت یک مشاهده Provider؛ بدون اختیار مستقیم برای تغییر وضعیت دامنه                             |

خریدار یک نقش امنیتی جدا نیست؛ هر هویت سوو با نشست معتبر خریدار می‌تواند سفارش
خود را ثبت کند. فروشندگی فعال و عضویت همان فروشگاه در هر درخواست فروشنده به شکل
زنده بررسی می‌شوند.

### قرارداد پاسخ مجوز

- نبود یا نامعتبر بودن نشست لازم: `401 UNAUTHENTICATED`؛
- نشست معتبر با audience نامناسب برای operation فروشنده: `403 FORBIDDEN`؛
- نشانی، سفارش، سبد متصل یا فروشگاه متعلق به شخص دیگر: `404 NOT_FOUND` تا وجود
  منبع افشا نشود؛
- سفارش غیرقابل اقدام برای query فروشنده، حتی اگر شناسه معتبر باشد: پاسخ `404`
  با کد `NOT_FOUND`؛
- callback نامعتبر در مرز adapter رد و با payload عمومی پاسخ داده می‌شود؛ جزئیات
  اعتبارسنجی یا وجود reference افشا نمی‌شود.

### مرز مالکیت

- secret سبد فقط اختیار همان سبد مهمان را می‌دهد و روش ورود یا هویت سوو نیست.
- پس از اتصال سبد، secret مهمان دیگر به‌تنهایی اجازه mutation نمی‌دهد.
- هر خریدار فقط نشانی‌ها و سفارش‌های خود را می‌خواند.
- فروشنده به سفارش پیش از `PAID` و به سفارش فروشگاه دیگر دسترسی ندارد.
- worker و callback فقط operation محدود پرداخت را فراخوانی می‌کنند؛ دسترسی عمومی
  به جدول سفارش، نشانی یا پرداخت ندارند.

## ۴. جریان اصلی و شکست‌ها

### ۴.۱ سبد مهمان و mutation

1. نخستین افزودن، یک سبد سروری تک‌فروشگاهی می‌سازد و secret تصادفی و opaque را
   در cookie امن قرار می‌دهد؛ cookie داده شخصی یا اقلام سبد ندارد.
2. هر سطر با `variantId` یکتا است، تعداد آن میان ۱ تا ۹۹ و شمار سطرهای فعال حداکثر
   ۱۰۰ است.
3. هر mutation، `expectedRevision` و `Idempotency-Key` می‌خواهد. موفقیت revision
   را یک واحد افزایش می‌دهد.
4. `Cart.v1` فقط شناسه گونه، تعداد و داده لازم برای نمایش پاسخ را نگه می‌دارد؛
   قیمت و قابلیت فروش همچنان از قراردادهای authoritative کالا و موجودی می‌آیند.
5. سبد پس از ۳۰ روز بی‌فعالیتی منقضی می‌شود. secret منقضی یا ناشناخته سبد تازه
   می‌سازد و وجود سبد قبلی را افشا نمی‌کند.

افزودن گونه همان فروشگاه، سطر موجود را به شکل idempotent به‌روز می‌کند. افزودن
گونه فروشگاه دیگر ابتدا `STORE_REPLACEMENT_CONFIRMATION_REQUIRED` همراه نام دو
فروشگاه و خلاصه اثر برمی‌گرداند. فقط operation تأیید جداگانه و idempotent سبد
قبلی را می‌بندد و سبد فروشگاه تازه را می‌سازد؛ رد یا بستن پیام چیزی را حذف
نمی‌کند.

`CART_REVISION_CONFLICT` کل mutation را رد می‌کند و snapshot و revision تازه
می‌دهد. server هیچ بخشی از mutation متعارض را اعمال نمی‌کند.

### ۴.۲ ورود، اتصال و تعارض دو سبد

پس از ورود، اگر هویت سبد فعال دیگری ندارد، سبد مهمان به `identityId` متصل و secret
مهمان rotate می‌شود. برای هر هویت فقط یک سبد فعال وجود دارد.

اگر هر دو سبد فعال باشند:

- فروشگاه متفاوت: خریدار خلاصه هر دو سبد را می‌بیند و یکی را صریح نگه می‌دارد؛
- فروشگاه یکسان: پاسخ، تغییر تعداد هر گونه و اقلام فقط‌در-یکی را نشان می‌دهد و
  خریدار ادغام یا نگه‌داشتن یکی را تأیید می‌کند؛
- تا پیش از تصمیم، هیچ سبدی تغییر نمی‌کند و ادامه checkout بسته است؛
- تأیید با revision هر دو سبد و `Idempotency-Key` انجام می‌شود؛ تغییر هم‌زمان با
  `CART_REVISION_CONFLICT` و خلاصه تازه رد می‌شود.

لغو یا شکست ورود فروشگاه، کالا و سبد مهمان را حفظ می‌کند و پس از ورود موفق مسیر
به همان قدم checkout برمی‌گردد.

### ۴.۳ نشانی و روش ارسال

نشانی ذخیره‌شده با هر ویرایش revision تازه می‌سازد. حذف، نسخه را از انتخاب آینده
خارج می‌کند ولی تاریخچه و snapshot سفارش‌های قبلی را پاک نمی‌کند.

برای روش دارای تحویل، `recipientName`، `recipientMobile`، `provinceText`،
`cityText` و `addressLine` لازم‌اند. `postalCode` برای `NATIONAL_POST` اجباری و
برای `COURIER` اختیاری است. موبایل و کدپستی فقط از نظر قالب normalize می‌شوند؛
checkout برای اعتبار شهر به dataset یا API بیرونی وابسته نیست.

روش `PICKUP` نشانی تحویل نمی‌سازد. جزئیات محل دریافت از revision روش ارسال
فروشگاه در snapshot ارسال سفارش ثبت می‌شود.

### ۴.۴ مرور نهایی سفارش

`PrepareCheckout.v1` این ورودی‌ها را می‌گیرد:

- `cartId/cartRevision`؛
- `savedAddressId/addressRevision` در صورت نیاز روش ارسال؛
- `shippingMethodId/shippingMethodRevision`؛
- actor و correlation جاری.

operation با خواندن authoritative از `ProductAuthoritativeRead.v1`،
`InventoryAvailabilityRead.v1` و `StoreAuthoritativeRead.v1` قیمت، قابلیت فروش،
تعداد، روش ارسال و سیاست مرجوعی را بررسی می‌کند. خروجی یک `checkoutRevision`
تغییرناپذیر با اعتبار ۱۰ دقیقه و snapshot قابل نمایش زیر است:

- اقلام، گونه، تعداد و `unitPrice` ریالی؛
- جمع اقلام، هزینه ارسال و مبلغ نهایی؛
- revisionهای کالا، سبد، نشانی، روش ارسال و سیاست مرجوعی؛
- نیاز یا عدم نیاز به نشانی تحویل؛
- زمان انقضای مرور و متن تسویه مستقیم.

`Money.v1` در persistence و API مبلغ صحیح ریال، `currency: IRR`، مضرب ۱۰ و در
بازه امن عدد صحیح JavaScript دارد. تومان فقط در مرز نمایش استفاده می‌شود و
مقدار قراردادی را تغییر نمی‌دهد:

`total = sum(unitPrice × quantity) + shippingFee`

هر تغییر با `CART_CHANGED` و diff ساختاریافته‌ای از نوع `PRICE_CHANGED`،
`QUANTITY_CHANGED`، `VARIANT_UNAVAILABLE`، `SHIPPING_METHOD_CHANGED`،
`SHIPPING_FEE_CHANGED` یا `POLICY_CHANGED` پاسخ داده می‌شود. رابط تغییر را کنار
مورد مربوط نشان می‌دهد، خریدار را به قدم درست برمی‌گرداند و تأیید تازه می‌خواهد.
ناموجودی ساخت سفارش را متوقف می‌کند.

### ۴.۵ ساخت سفارش و رزرو موجودی

1. `CreateOrder.v1` همان `checkoutRevision` و تمام revisionهای تأییدشده را با
   `Idempotency-Key` می‌گیرد.
2. workflow پیش از transaction شناسه پایدار سفارش را می‌سازد.
3. داخل یک transaction پایگاه داده، سفارش و snapshotهای اقلام، نشانی تحویل، روش
   ارسال و سیاست مرجوعی ثبت می‌شوند و `InventoryReservation.v1` رزرو مشروط
   ۱۵ دقیقه‌ای را ایجاد می‌کند.
4. هر مالک فقط جدول و outbox خودش را می‌نویسد و transaction context مات است.
5. پس از commit، سفارش `PENDING_PAYMENT` و قابل پیگیری است. تماس Provider هرگز
   داخل این transaction نیست.

شکست هر write یا کمبود موجودی transaction را کامل rollback می‌کند؛ سفارش نیمه،
snapshot بدون رزرو یا رزرو یتیم ساخته نمی‌شود. replay همان payload همان سفارش و
پاسخ را می‌دهد. payload متفاوت با همان کلید `IDEMPOTENCY_CONFLICT` است.

### ۴.۶ ساخت و ارسال تلاش پرداخت

1. `CreateDirectPaymentAttempt.v1` برای مبلغ snapshot‌شده سفارش یک تلاش `CREATED`
   پایدار می‌سازد.
2. پیش از تماس بیرونی، رزرو با شناسه همان تلاش و lease دو دقیقه‌ای از راه
   `InventoryReservation.v1` hold و تلاش `DISPATCHED` ثبت می‌شود.
3. پس از commit، `DirectPaymentProvider.v1.initiate` فراخوانی و نتیجه ارسال در
   تلاش ثبت می‌شود.
4. خریدار به صفحه Provider توسعه یا نتیجه برمی‌گردد و callback فقط پس از
   `verifyAndMapCallback` به دامنه اعمال می‌شود.

هر سفارش فقط یک تلاش فعال دارد. درخواست هم‌زمان همان تلاش را برمی‌گرداند. پس از
`FAILED` و تا اعتبار رزرو، تلاش تازه با شناسه و کلید تازه مجاز است. retry مهلت
سفارش را تمدید نمی‌کند. `CONFIRMED`، `REVIEW_REQUIRED` و سفارش `EXPIRED` پرداخت
دوباره را می‌بندند.

### ۴.۷ نتیجه پرداخت و handoff

نتیجه معتبر Provider در transaction مشترک و idempotent اعمال می‌شود:

| نتیجه معتبر          | پرداخت                 | سفارش             | موجودی                         | نمایش فروشنده                                                 |
| -------------------- | ---------------------- | ----------------- | ------------------------------ | ------------------------------------------------------------- |
| `CONFIRMED`          | تلاش `CONFIRMED`       | `PAID`            | رزرو دقیقاً یک‌بار مصرف می‌شود | `OrderBecameActionable.v1` پس از نهایی‌شدن اتمیک منتشر می‌شود |
| `FAILED` پیش از مهلت | تلاش `FAILED`          | `PENDING_PAYMENT` | رزرو تا مهلت اولیه فعال می‌شود | هیچ سفارش قابل اقدامی ندارد                                   |
| `FAILED` پس از مهلت  | تلاش `FAILED`          | `EXPIRED`         | رزرو دقیقاً یک‌بار آزاد می‌شود | هیچ سفارش قابل اقدامی ندارد                                   |
| `PENDING`            | تلاش `REVIEW_REQUIRED` | `PAYMENT_REVIEW`  | رزرو `HELD_FOR_REVIEW` است     | هیچ سفارش قابل اقدامی ندارد                                   |

موفقیت فقط وقتی `OrderBecameActionable.v1` می‌سازد که مبلغ دقیقاً برابر snapshot
باشد و رزرو همان سفارش قابل مصرف باشد. سفارش در `PAID` می‌ماند؛ آماده‌سازی و
ارسال وضعیت‌های ماژول انجام سفارش‌اند.

موفقیت دیررس پس از آزادشدن رزرو به‌عنوان واقعیت مالی `CONFIRMED` ثبت می‌شود، اما
موجودی منفی یا handoff نمی‌سازد. سفارش با reason code غیرحساس
`PAID_STOCK_CONFLICT` در `PAYMENT_REVIEW` می‌ماند، alert بحرانی می‌سازد و خریدار
می‌بیند «پرداخت ثبت شده و سفارش برای بررسی موجودی در سوو است». در این برش عامل
پلتفرم حق حدس یا تعیین دستی نتیجه مالی ندارد.

### ۴.۸ نتیجه مبهم، callback و تطبیق

`DirectPaymentProvider.v1` سه port دارد:

- `initiate(attemptId, amount, callbackContext)`؛
- `verifyAndMapCallback(rawInput)`؛
- `query(providerReference)`.

adapter فقط `CONFIRMED | FAILED | PENDING`، `providerReference` یکتا و metadata
غیرحساس برمی‌گرداند. controller به raw callback اعتماد نمی‌کند. شناسه رخداد
Provider و `providerReference` یکتا هستند و callback تکراری پاسخ و اثر ثبت‌شده را
replay می‌کند.

موفقیت قطعی downgrade نمی‌شود. شکست قطعی همان تلاش به موفق تبدیل نمی‌شود؛ نتیجه
متناقض، مبلغ ناسازگار، reference ناشناخته یا callback نامعتبر به تغییر قطعی
دامنه منجر نمی‌شود و با reason code غیرحساس برای بررسی عملیاتی ثبت می‌شود.

worker برای تلاش `REVIEW_REQUIRED` بلافاصله و سپس در دقیقه‌های ۱، ۲، ۵، ۱۰، ۲۰ و
۳۰ query می‌کند. پس از ۳۰ دقیقه alert می‌سازد و هر ۳۰ دقیقه ادامه می‌دهد. زمان
به‌تنهایی `PENDING` را موفق یا ناموفق نمی‌کند و سفارش `PAYMENT_REVIEW` خودکار
منقضی نمی‌شود.

### ۴.۹ بازیابی lease و failure modeها

| شکست                                        | رفتار قطعی و قابل بازیابی                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| crash پیش از commit ساخت سفارش              | سفارش و رزرو وجود ندارند؛ replay کل operation را از ابتدا اجرا می‌کند                         |
| crash پس از commit سفارش و پیش از ساخت تلاش | سفارش `PENDING_PAYMENT` و رزرو دارای deadline است؛ خریدار می‌تواند ساخت تلاش را retry کند     |
| crash پس از hold و پیش از ثبت dispatch      | پایان lease، hold را تا مهلت اولیه فعال یا پس از آن آزاد می‌کند                               |
| dispatch ثبت‌شده بدون نتیجه                 | پایان lease، رزرو را `HELD_FOR_REVIEW` و تلاش را `REVIEW_REQUIRED` می‌کند و تطبیق آغاز می‌شود |
| timeout یا `5xx` Provider                   | نتیجه حدس زده نمی‌شود؛ تلاش به بررسی می‌رود                                                   |
| callback تکراری                             | نتیجه قبلی بدون اثر دوم replay می‌شود                                                         |
| callback متناقض یا مبلغ نابرابر             | وضعیت قطعی downgrade نمی‌شود؛ alert و بررسی عملیاتی بدون handoff                              |
| outbox با تأخیر                             | transaction اصلی باقی می‌ماند؛ تحویل حداقل یک‌بار و مصرف idempotent retry می‌شود              |
| انقضای سفارش بدون تلاش فعال                 | سفارش `EXPIRED` و رزرو دقیقاً یک‌بار آزاد می‌شود                                              |
| نتیجه ناموفق پس از انقضا                    | همان نتیجه replay می‌شود؛ رزرو دوباره باز نمی‌شود                                             |
| موفقیت دیررس بدون موجودی قابل مصرف          | پرداخت ثبت، سفارش `PAYMENT_REVIEW`، بدون oversell و بدون handoff                              |

هیچ hold تلاش پرداخت بدون `leaseUntil` و مسیر بازیابی باقی نمی‌ماند.

### ۴.۱۰ متن و رفتار رابط

رابط از [سیستم طراحی پایه](../product/design-system.md) و الگوی «تمرکز آرام»
پیروی می‌کند. هر قدم یک صفحه مستقل و یک اقدام اصلی دارد و اطلاعات ضروری اعتماد
برای خلوت‌شدن ظاهر پنهان نمی‌شوند.

مرور نهایی این متن ثابت را پیش از اقدام پرداخت نشان می‌دهد:

> **تسویه مستقیم:** مبلغ این سفارش مستقیماً برای فروشگاه تسویه می‌شود. سیاست
> مرجوعی را فروشگاه تعیین می‌کند. سوو گزارش مشکل و تخلف را پیگیری می‌کند، اما
> بازپرداخت را تضمین نمی‌کند.

دکمه نهایی هم ماهیت اقدام و هم مبلغ نمایشی را می‌گوید: «ثبت سفارش و پرداخت
… تومان». هیچ هزینه‌ای پس از این تأیید افزوده نمی‌شود.

صفحه نتیجه در هر حالت وضعیت و قدم بعدی را نشان می‌دهد:

- موفق: «پرداخت تأیید شد»؛ رسید و زمان و توضیح اینکه سفارش اکنون برای فروشگاه
  قابل اقدام است؛
- ناموفق: «پرداخت انجام نشد»؛ دلیل عمومی، زمان باقی‌مانده رزرو و اقدام «تلاش
  دوباره»؛
- در حال بررسی: «نتیجه پرداخت در حال بررسی است»؛ پرداخت دوباره بسته و توضیح
  اینکه فروشگاه هنوز سفارشی برای آماده‌سازی ندارد؛
- منقضی: «مهلت پرداخت تمام شد»؛ توضیح آزادشدن رزرو و بازگشت به سبد؛
- موفقیت دیررس ناسازگار با موجودی: توضیح ثبت پرداخت و بررسی موجودی، بدون وعده
  قطعی انجام یا بازپرداخت.

## ۵. state، invariant و transaction

### state machine سبد و مرور نهایی

سبد فعال revision افزایشی و `expiresAt` دارد. تبدیل، جایگزینی یا انقضا terminal
است و mutation بعدی سبد تازه می‌خواهد. `checkoutRevision` فقط برای همان هویت،
سبد، نشانی و روش ارسال معتبر و پس از ۱۰ دقیقه منقضی است؛ استفاده از آن سبد را
قفل نمی‌کند، اما هر تغییر revision آن را stale می‌کند.

### state machine سفارش

```text
PENDING_PAYMENT ──confirmed + inventory committed──▶ PAID
       │
       ├──provider pending/ambiguous───────────────▶ PAYMENT_REVIEW
       └──deadline + no unresolved attempt────────▶ EXPIRED

PAYMENT_REVIEW ──confirmed + inventory committed──▶ PAID
       │
       ├──failed before original deadline─────────▶ PENDING_PAYMENT
       ├──failed at/after original deadline───────▶ EXPIRED
       └──late success without stock──────────────▶ PAYMENT_REVIEW

EXPIRED ──late success / provider conflict─────────▶ PAYMENT_REVIEW
```

`PAID` در محدوده این برش terminal است. `EXPIRED` تلاش پرداخت تازه را می‌بندد،
اما نتیجه دیررس یا متناقض می‌تواند آن را برای پیگیری به `PAYMENT_REVIEW` ببرد؛
این گذار رزرو آزادشده را باز نمی‌کند و سفارش قابل اقدام نمی‌سازد. وضعیت‌های
`CANCELLATION_PENDING_REFUND` و `CANCELED` برای کار آینده رزرو شده‌اند و operation
این Spec آن‌ها را تولید نمی‌کند.

### state machine تلاش پرداخت

```text
CREATED → DISPATCHED → CONFIRMED | FAILED | REVIEW_REQUIRED
                         REVIEW_REQUIRED → CONFIRMED | FAILED
```

`DISPATCHED` وضعیت پایدار انتظار برای نخستین نتیجه Provider است. نتیجه
`PENDING` خودِ Provider به `REVIEW_REQUIRED` نگاشت می‌شود و state پایدار جداگانه‌ای
به نام `PENDING_RESULT` در قرارداد اجرایی ندارد.

`CONFIRMED` downgrade نمی‌شود. `FAILED` همان تلاش terminal است و فقط تلاش تازه،
در صورت مجاز بودن سفارش و رزرو، ساخته می‌شود. نتیجه متناقض state قطعی را عوض
نمی‌کند.

### invariantها

- هر سبد فعال دقیقاً یک فروشگاه دارد و هر `variantId` فقط یک سطر دارد.
- برای هر هویت حداکثر یک سبد فعال وجود دارد.
- snapshot سفارش پس از ساخت تغییر نمی‌کند.
- مبلغ پرداخت دقیقاً با `Money.v1` snapshot سفارش برابر است.
- هر سفارش حداکثر یک تلاش پرداخت فعال دارد.
- `payment_attempts.order_id` یک مرجع scalar از نوع `OrderId` است؛ ماژول پرداخت
  وجود، مالکیت و وضعیت قابل‌پرداخت سفارش را فقط از قرارداد نسخه‌دار سفارش و بدون
  foreign key یا رابطه Prisma میان‌ماژولی بررسی می‌کند.
- `PAID` فقط همراه پرداخت `CONFIRMED` و رزرو مصرف‌شده قابل ثبت است.
- `OrderBecameActionable.v1` برای هر سفارش حداکثر یک اثر معنایی دارد.
- `onHand`، `reserved` و `available` متعلق به موجودی‌اند؛ سفارش مقدار authoritative
  دیگری برای آن‌ها نگه نمی‌دارد.
- رزرو مصرف‌شده دوباره فعال یا آزاد نمی‌شود؛ بازگشت بعد از پرداخت فقط adjustment
  ممیزی‌شده موجودی است.
- `PAYMENT_REVIEW` پرداخت دوباره و انقضای خودکار را می‌بندد.
- هیچ تماس Provider داخل transaction پایگاه داده انجام نمی‌شود.

### مرز transaction

| operation             | participantهای transaction                                                       | پس از commit                                                |
| --------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| mutation سبد یا نشانی | فقط سفارش و idempotency همان operation                                           | ندارد                                                       |
| `PrepareCheckout.v1`  | ثبت revision مرور در سفارش؛ خواندن producerها بدون نوشتن جدول آن‌ها              | ندارد                                                       |
| `CreateOrder.v1`      | سفارش، snapshotها، رزرو موجودی و outboxهای هر دو مالک با transaction context مات | ساخت تلاش پرداخت به درخواست خریدار یا workflow پس از commit |
| ساخت/dispatch تلاش    | پرداخت، idempotency و hold موجودی پیش از تماس                                    | `initiate` Provider                                         |
| اعمال نتیجه معتبر     | پرداخت، سفارش، رزرو موجودی و outboxهای سه مالک                                   | تحویل رخداد، اعلان و handoff idempotent                     |
| انقضا و بازیابی       | مالک state مربوط و outbox خودش؛ operation idempotent                             | retry outbox یا reconciliation                              |

## ۶. قراردادهای تولیدی

این Spec مالک schema، invariant و compatibility قراردادهای سفارش و پرداخت در
[ردیف‌های canonical سفارش و پرداخت](../architecture/v1-contract-dependency-graph.md#جدول-canonical)
است. افزودن فیلد اختیاری سازگار در `v1` مجاز است؛ تغییر ناسازگار با `v2` کنار
`v1`، مهاجرت مصرف‌کننده و سپس حذف نسخه قدیمی انجام می‌شود.

### سفارش — `@sevo/contracts/orders/v1`

| قرارداد                        | operationهای عمومی                                                                    | خطاهای دامنه اصلی                                                                                                                                         | PII و consistency                                    |
| ------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `Cart.v1`                      | ساخت/خواندن سبد، upsert/remove سطر، تأیید جایگزینی فروشگاه، attach و resolve conflict | `CART_REVISION_CONFLICT`، `CART_EXPIRED`، `INVALID_QUANTITY`، `CART_LIMIT_REACHED`، `STORE_REPLACEMENT_CONFIRMATION_REQUIRED`، `CART_RESOLUTION_REQUIRED` | بدون PII؛ mutationها strong و idempotent             |
| `SavedAddress.v1`              | list/create/update/delete revision                                                    | `ADDRESS_INVALID`، `ADDRESS_REVISION_CONFLICT`، `ADDRESS_NOT_FOUND`                                                                                       | PII؛ فقط خریدار مالک، `Cache-Control: no-store`      |
| `PrepareCheckout.v1`           | ساخت مرور نهایی ۱۰ دقیقه‌ای                                                           | `CART_CHANGED`، `CHECKOUT_NOT_READY`، `CHECKOUT_REVISION_EXPIRED`                                                                                         | نشانی فقط در command/query؛ readها authoritative     |
| `CreateOrder.v1`               | ساخت سفارش از revisionهای تأییدشده                                                    | `CART_CHANGED`، `CHECKOUT_REVISION_EXPIRED`، `OUT_OF_STOCK`، `ADDRESS_INVALID`، `SHIPPING_METHOD_UNAVAILABLE`                                             | transaction strong با رزرو؛ snapshot دارای PII محدود |
| `BuyerOrderRead.v1`            | جزئیات و timeline سفارش همان خریدار                                                   | `ORDER_NOT_FOUND`                                                                                                                                         | PII فقط همان خریدار؛ `no-store`                      |
| `SellerActionableOrderRead.v1` | list/detail سفارش قابل اقدام و reveal دلیل‌دار                                        | `ORDER_NOT_FOUND`، `DELIVERY_DETAILS_NOT_AVAILABLE`، `REVEAL_REASON_REQUIRED`                                                                             | خروجی پیش‌فرض ماسک؛ reveal ممیزی‌شده و `no-store`    |

گروه routeهای OpenAPI سفارش:

- `/v1/cart` و `/v1/cart/items/{variantId}` برای سبد جاری؛
- `/v1/cart/store-replacement`، `/v1/cart/attach` و `/v1/cart/resolve` برای تصمیم
  صریح و اتصال پس از ورود؛
- `/v1/addresses` و `/v1/addresses/{addressId}` برای نشانی نسخه‌دار؛
- `/v1/checkout/prepare` و `/v1/orders` برای مرور و ساخت؛
- `/v1/seller/orders` برای فهرست سفارش‌های قابل اقدام فروشنده؛
- `/v1/seller/buyers` برای `ListStoreBuyers.v1` با جست‌وجو، cursor امضاشده و
  خلاصه ماسک‌شده؛
- `/v1/seller/orders/{orderId}/delivery-details/reveal` برای مشاهده ممیزی‌شده
  اطلاعات تحویل همان فروشگاه.

`ordersV1Operations` مرجع اجرایی operationId، method و path مسیرهای موجود این
نسخه است و fragment OpenAPI مستقیماً از آن ساخته می‌شود. مسیرهای فهرست خریداران
مرتبط و reveal اکنون runtime و قرارداد پاسخ دارند. مسیر جزئیات سفارش خریدار و
جزئیات عمومی فروشنده تا زمان ساخت controller و قرارداد پاسخ خود وارد این مرجع و
OpenAPI نمی‌شوند؛ ثبت path بدون runtime مجاز نیست.

رخدادهای سفارش:

- `OrderCreated.v1` و `OrderExpired.v1`؛
- `OrderPaymentReviewRequired.v1`؛
- `OrderBecameActionable.v1`.

### پرداخت — `@sevo/contracts/payments/v1`

| قرارداد                    | operationهای عمومی/داخلی                       | خطاهای دامنه اصلی                                                                                                                                           | PII و consistency                                 |
| -------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `DirectPaymentAttempt.v1`  | ساخت و خواندن تلاش، dispatch و ثبت نتیجه معتبر | `ORDER_NOT_PAYABLE`، `IDEMPOTENCY_CONFLICT`، `IDEMPOTENCY_IN_PROGRESS`، `AMOUNT_MISMATCH`، `ATTEMPT_NOT_FOUND`، `INVALID_CALLBACK`، `PRECONDITION_REQUIRED` | بدون callback خام؛ نهایی‌سازی strong و idempotent |
| `DirectPaymentProvider.v1` | `initiate`، `verifyAndMapCallback` و `query`   | خطای typed adapter، بدون نشت پاسخ خام                                                                                                                       | تماس بیرونی خارج از transaction                   |

گروه routeهای OpenAPI پرداخت:

- `/v1/orders/{orderId}/payment-attempts` برای ساخت تلاش؛
- `/v1/payment-attempts/{attemptId}` برای خواندن وضعیت توسط خریدار همان سفارش؛
- `/internal/v1/payment-providers/{provider}/callbacks` برای callback
  اعتبارسنجی‌شده؛
- operation داخلی worker برای claim و تطبیق تلاش‌های نیازمند بررسی، بدون route
  عمومی؛
- `/v1/platform/payment-reviews` برای صف محدود بررسی عملیاتی عامل دارای مجوز.

صف بررسی پرداخت فقط شناسه پرونده، نوع بررسی، مبلغ، Provider، زمان ورود به صف و
وجود نیاز به پیگیری را برمی‌گرداند؛ شناسه سفارش، reference و رویدادهای Provider و
تاریخچه تطبیق در صف نمایش داده نمی‌شوند. آشکارسازی کمینه جزئیات از
`/v1/platform/payment-reviews/{reviewId}/reveal` به اقدام صریح، دلیل انسانی و
اجازه دسترسی حساس فعال با scope همان `reviewId` و action برابر
`REVEAL_MINIMUM` نیاز دارد. مجوز مسئولیت و اجازه زمان‌دار در همان transaction
خواندن دوباره بررسی و مشاهده در audit دسترسی ثبت می‌شوند؛ لغو یا انقضا fail-closed
است.

عامل می‌تواند از
`/v1/platform/payment-reviews/{reviewId}/reconciliation` فقط تطبیق دوباره همان
تلاش `REVIEW_REQUIRED` را زودتر در صف worker قرار دهد. این operation نتیجه مالی
نمی‌گیرد و موفق یا ناموفق‌کردن دستی ارائه نمی‌کند؛ گذار فقط پس از نتیجه معتبر
Provider در مسیر موجود نهایی‌سازی انجام می‌شود.

`paymentsV1Operations` مرجع اجرایی operationId، method و path این routeهاست و
fragment OpenAPI مستقیماً از همان مرجع ساخته می‌شود.

رخدادهای پرداخت:

- `DirectPaymentAttemptCreated.v1`؛
- `DirectPaymentAttemptDispatched.v1`؛
- `DirectPaymentAttemptConfirmed.v1`؛
- `DirectPaymentAttemptFailed.v1`؛
- `DirectPaymentAttemptReviewRequired.v1`.

stateهای سفارش و تلاش، stateهای terminal و شکل audit در همان entrypointهای
نسخه‌دار با `OrderStatus`، `OrderStateTransitionAudit`،
`DirectPaymentAttemptStatus` و `PaymentAttemptAudit` منتشر می‌شوند. فقط `PAID`
برای سفارش و `CONFIRMED` و `FAILED` برای همان تلاش پرداخت terminal هستند.
`EXPIRED` برای سفارش terminal نیست: پرداخت تازه بسته است، اما پیگیری نتیجه
دیررس یا متناقض با گذار به `PAYMENT_REVIEW` ممکن می‌ماند.
`REVIEW_REQUIRED` پرداخت دوباره را می‌بندد اما برای تطبیق همان تلاش
terminal نیست. audit فقط شناسه aggregate، وضعیت قبل/بعد، reason code غیرحساس،
`actorKind` سرویس، correlation و زمان را دارد.

### envelope رخداد

رخداد فقط `aggregateId`، `aggregateVersion`، وضعیت، مبلغ لازم، timestamp،
`correlationId` و `causationId` دارد. نام، موبایل، نشانی، متن سیاست، reason text
انسانی، secret سبد، token، callback خام یا metadata خام Provider در outbox و
event ممنوع‌اند. مصرف‌کننده جزئیات را فقط از query مجاز مالک می‌گیرد.

## ۷. قراردادهای مصرفی و یال‌ها

این Spec schema یا state machine قرارداد زیر را تکرار نمی‌کند:

| producer و قرارداد canonical                                   | مصرف این Spec                                                 | یال                                        | fake مجاز و شرط حذف                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| platform: `Money.v1`، envelope خطا/رخداد و transaction context | همه operationها، idempotency و outbox                         | `contract-blocks`                          | fake مجاز نیست؛ baseline نسخه‌دار پیش از ساخت                                     |
| هویت و دسترسی: `IdentitySession.v1` و `ActorContext.v1`        | actor خریدار/فروشنده و ownership                              | `contract-blocks`                          | fake فقط unit؛ integration نشست واقعی لازم                                        |
| هویت و دسترسی: `SellerAccess.v1`                               | مجوز زنده query فروشنده                                       | `contract-blocks` سپس `integration-blocks` | fake قراردادی تا اجرای فروشندگی فعال؛ پیش از E2E فروشنده حذف                      |
| فروشگاه: `StoreAuthoritativeRead.v1`                           | revision روش ارسال، هزینه، نیاز نشانی و snapshot سیاست مرجوعی | `contract-blocks` سپس `integration-blocks` | fixture ثابت نسخه‌دار؛ پیش از integration checkout واقعی حذف                      |
| کالا: `ProductAuthoritativeRead.v1`                            | store/variant، قیمت، قابلیت فروش و revision                   | `contract-blocks` سپس `integration-blocks` | fake سناریومحور؛ پیش از integration قیمت و انتشار واقعی حذف                       |
| موجودی: `InventoryAvailabilityRead.v1`                         | نمایش availability و بازاعتبارسنجی                            | `contract-blocks` سپس `integration-blocks` | fake read؛ پیش از integration موجودی واقعی حذف                                    |
| موجودی: `InventoryReservation.v1`                              | reserve، hold، commit، release و hold-for-review              | `contract-blocks` سپس `integration-blocks` | fake transactional برای ساخت؛ تست oversell و handoff فقط با PostgreSQL واقعی مالک |
| انجام سفارش: مصرف `OrderBecameActionable.v1`                   | آغاز `ACTION_REQUIRED`                                        | خروجی این Spec؛ `integration-blocks`       | spy/consumer fake در contract test؛ حذف پیش از E2E handoff                        |

fake کالا سناریوهای قیمت ثابت، تغییر قیمت، توقف انتشار، گونه ناموجود و تعلق به
فروشگاه دیگر را دارد. fake موجودی ظرفیت کافی، کمبود، رقابت دو رزرو، hold منقضی،
commit تکراری و موفقیت دیررس را پوشش می‌دهد. fake فروشگاه روش ارسال فعال، revision
تغییرکرده، دریافت حضوری و سیاست مرجوعی نسخه‌دار را برمی‌گرداند.

`DevDirectPaymentProvider` بخشی از ماژول پرداخت این Spec است، نه fake قرارداد
producer دیگر. نتیجه موفق، ناموفق و `PENDING` را deterministic تولید می‌کند و
`PENDING` با `query` به نتیجه قطعی fixture تبدیل می‌شود. انتخاب سناریو فقط در
local/test ممکن است و startup production با این adapter باید fail شود.

## ۸. مالکیت داده، فایل و migration

### مالکیت ماژول و جدول

| ماژول مالک | خانواده جدول پیشنهادی                                                                                            | داده تحت مالکیت                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| سفارش      | `order_carts`، `order_cart_items` و `order_cart_access_tokens`                                                   | سبد، revision، انقضا و hash secret                     |
| سفارش      | `order_saved_addresses` و `order_saved_address_revisions`                                                        | نشانی نسخه‌دار و وضعیت انتخاب آینده                    |
| سفارش      | `order_checkout_preparations`                                                                                    | revision مرور ۱۰ دقیقه‌ای و hash ورودی canonical       |
| سفارش      | `order_orders`، `order_items`، `order_delivery_snapshots`، `order_shipping_snapshots` و `order_policy_snapshots` | سفارش و snapshot تغییرناپذیر                           |
| سفارش      | `order_state_transitions` و `order_sensitive_access_audit`                                                       | timeline و reveal ممیزی‌شده                            |
| پرداخت     | `payment_attempts`، `payment_provider_observations` و `payment_reconciliation_claims`                            | تلاش، reference غیرحساس، dedup callback و lease worker |
| هر مالک    | `*_idempotency_records` و outbox همان ماژول                                                                      | scope، hash payload، پاسخ replay و رخداد همان مالک     |

موجودی مالک جدول رزرو، مقدار `onHand/reserved/available` و migrationهای آن است.
سفارش فقط `reservationId` را نگه می‌دارد و هیچ جدول یا model موجودی را مستقیم
نمی‌خواند. پرداخت نیز `orderId` را فقط به‌صورت scalar نگه می‌دارد و invariant
سفارش را از `@sevo/contracts/orders/v1` مصرف می‌کند؛ هیچ FK، join یا رابطه ORM
میان جدول‌های پرداخت و سفارش مجاز نیست. فروشگاه و کالا نیز هیچ جدول تکراری در
این Spec ندارند.

### خانواده فایل‌های Issueهای ساخت

- قرارداد سفارش: `packages/contracts/src/orders/v1/**`؛
- قرارداد پرداخت: `packages/contracts/src/payments/v1/**`؛
- ماژول API سفارش: `apps/api/src/modules/orders/**`؛
- ماژول API پرداخت و Provider توسعه: `apps/api/src/modules/payments/**`؛
- worker تطبیق: `apps/worker/src/modules/payments/**`؛
- OpenAPI متعلق به ماژول‌ها: fragment و operations سفارش و پرداخت در slotهای
  baseline زیر `apps/api/src/openapi/`؛
- migration سفارش: `packages/database/prisma/migrations/*__orders__*`؛
- migration پرداخت: `packages/database/prisma/migrations/*__payments__*`؛
- رابط خریدار: `apps/web/src/app/(buyer)/cart/**`،
  `apps/web/src/app/(buyer)/checkout/**` و `apps/web/src/app/(buyer)/orders/**`؛
- رابط فروشنده سفارش قابل اقدام: `apps/web/src/app/(seller)/seller/orders/**`؛
- پذیرش سرتاسری: `tests/e2e/cart-order-direct-payment/**` و integration/contract
  کنار ماژول مالک.

نام دقیق فایل‌های generated فقط پس از baseline تعیین می‌شود. Issueهای این مسیر
حق تغییر generator/datasource مرکزی Prisma، composer مرکزی OpenAPI، barrel یا
export مرکزی بسته قراردادها، design system و پیکربندی سراسری را ندارند. slotهای
ماژول، schema چندفایلی و entrypointهای نسخه‌دار باید در baseline تک‌مالک ایجاد
شوند.

`docs/architecture/module-ownership.json` همراه baseline یا Issue مالک migration
به شکل تک‌مالک برای جدول و entrypoint تازه به‌روز می‌شود؛ دو شاخه هم‌زمان همان
فایل مرکزی را تغییر نمی‌دهند.

## ۹. PII، حریم خصوصی و observability

### داده مجاز و ممنوع

- raw secret سبد فقط در cookie `HttpOnly`، `Secure` در محیط امن،
  `SameSite=Lax` و path محدود حمل می‌شود؛ پایگاه داده فقط hash مقاوم نگه می‌دارد.
- نام گیرنده، موبایل، کدپستی و نشانی فقط در جدول‌های محدود سفارش و پاسخ مجاز
  خریدار/فروشنده وجود دارند.
- raw callback، token، header احراز، secret سبد، نشانی و metadata خام Provider در
  log، trace، metric، رخداد، projection عمومی و fixture ممنوع‌اند.
- لاگ فقط شناسه‌های داخلی، provider code، reason code غیرحساس، correlation و
  زمان را نگه می‌دارد.
- محیط نهایی encryption در storage و backup می‌خواهد. field-level encryption تا
  تصمیم مدیریت و چرخش کلید وارد این برش نمی‌شود.
- snapshot سفارش تا تصمیم کتبی retention حقوقی حذف نمی‌شود؛ endpoint حذف نشانی
  فقط انتخاب آینده را می‌بندد.

فروشنده شماره کامل و نشانی را فقط برای سفارش قابل اقدام از `PAID` تا پایان بازه
لازم انجام سفارش می‌بیند. پس از آن خروجی پیش‌فرض ماسک است و reveal دوباره دلیل
ثبت‌شده، audit با actor/time/order/reason code و `Cache-Control: no-store` می‌خواهد.
دنبال‌کردن، گفت‌وگوی عادی یا فروشگاه دیگر هیچ دسترسی ایجاد نمی‌کند.

در پیاده‌سازی `ListStoreBuyers.v1`، cursor به فروشگاه و عبارت جست‌وجو bind و با
کلید مشتق‌شده امضا می‌شود. audit reveal متن آزاد یا PII را کپی نمی‌کند: فقط کد
بسته دلیل و اثر SHA-256 دلیل را نگه می‌دارد. reveal صریح همیشه دلیل می‌خواهد؛
بنابراین projection کمینه orders-owned رخدادهای نسخه‌دار fulfillment فقط وضعیت
نمایشی خلاصه را می‌سازد و منبع مجوز آشکارسازی نیست. جدول ماژول fulfillment
مستقیماً خوانده نمی‌شود و lag یا نبود projection مجوز fail-open ایجاد نمی‌کند.

### idempotency و قابلیت پیگیری

هویت idempotency برابر `operation + actor/cart scope + key` است. رکورد، hash
canonical payload، `IN_PROGRESS | COMPLETED`، lease درخواست جاری و پاسخ نهایی را
نگه می‌دارد:

- payload یکسان: replay همان status/body و شناسه‌ها؛
- payload متفاوت: `409 IDEMPOTENCY_CONFLICT`؛
- درخواست هم‌زمان: `409 IDEMPOTENCY_IN_PROGRESS` با `Retry-After`؛
- رکورد سبد: هم‌عمر چرخه ۳۰ روزه؛
- رکورد سفارش، رزرو و پرداخت: تا پایان retention رکورد مالی.

### metric، alert و audit

metricها بدون label دارای cardinality یا PII:

- نرخ `CART_REVISION_CONFLICT` و تعارض اتصال سبد؛
- latency و نتیجه `PrepareCheckout.v1` و `CreateOrder.v1`؛
- شمار `OUT_OF_STOCK` و rollback ساخت سفارش؛
- gauge رزرو فعال، hold منقضی و رزرو نیازمند بررسی؛
- شمار تلاش بر اساس state و زمان تا نتیجه قطعی؛
- callback تکراری، نامعتبر، مبلغ ناسازگار و reference ناشناخته؛
- عمق و سن قدیمی‌ترین reconciliation و outbox؛
- handoff قابل اقدام و lag مصرف آن.

alertها برای تلاش مبهم بیش از ۳۰ دقیقه، hold بدون بازیابی پس از lease، موفقیت دیررس
با `PAID_STOCK_CONFLICT`، callback متناقض، مبلغ ناسازگار، failure مداوم Provider،
lag خارج از SLO outbox و invariant شکسته رزرو ساخته می‌شوند.

هر درخواست یک `correlationId` دارد؛ commandهای مشتق‌شده و رخدادها
`causationId` را حفظ می‌کنند. audit تغییر state سفارش/پرداخت، actor یا service،
زمان، وضعیت قبل/بعد و reason code غیرحساس را ثبت می‌کند.

## ۱۰. معیار پذیرش و برش Issueها

### unit

- محدودیت تعداد و سطر، revision، idempotency و جایگزینی تک‌فروشگاهی سبد؛
- ماتریس ادغام دو سبد و رد mutation متعارض بدون اثر جزئی؛
- نسخه‌سازی نشانی و قواعد `NATIONAL_POST`، `COURIER` و `PICKUP`؛
- محاسبه صحیح ریال و منع مبلغ نامعتبر؛
- همه transitionهای مجاز و نامعتبر سفارش و تلاش پرداخت؛
- منع retry در `REVIEW_REQUIRED/CONFIRMED/EXPIRED`؛
- mapping سناریوهای deterministic Provider توسعه؛
- redaction داده حساس از log، رخداد و خطا.

### integration با PostgreSQL

- دو mutation هم‌زمان سبد و تضمین revision افزایشی؛
- یک سبد فعال برای هر هویت زیر login هم‌زمان؛
- rollback اتمیک سفارش و رزرو در خطای هر participant؛
- رقابت دو سفارش برای آخرین موجودی بدون oversell؛
- callback و `CreateOrder` هم‌زمان یا تکراری با یک اثر؛
- crash pointهای پیش و پس از commit و بازیابی lease؛
- تطبیق `PENDING`، شکست پیش/پس از مهلت و موفقیت دیررس بدون موجودی منفی؛
- outbox حداقل یک‌بار با consumer idempotent و فقط یک handoff معنایی؛
- query seller فقط برای سفارش قابل اقدام و audit اتمیک reveal.

### contract و compatibility

- schema و مثال موفق/خطای OpenAPI برای همه routeهای سفارش و پرداخت؛
- drift test میان contract runtime، JSON Schema و OpenAPI؛
- consumer contract در برابر fakeهای کالا، موجودی، فروشگاه، هویت و انجام سفارش؛
- contract adapter برای `initiate`، callback تکراری/نامعتبر و `query`؛
- compatibility رخدادهای v1، envelope و منع PII؛
- startup guard که Provider توسعه را در production رد می‌کند.

### E2E و تجربه رابط

- مهمان کالا را به سبد می‌افزاید، وارد می‌شود و همان سبد را ادامه می‌دهد؛
- تعارض دو سبد در هر دو حالت فروشگاه یکسان و متفاوت فقط با تصمیم صریح حل می‌شود؛
- تغییر قیمت، ناموجودی و تغییر هزینه ارسال مرور تازه می‌خواهند؛
- دریافت حضوری بدون نشانی و پست با کدپستی لازم کار می‌کنند؛
- پرداخت موفق رسید می‌سازد و سفارش دقیقاً یک‌بار به فروشنده تحویل می‌شود؛
- پرداخت ناموفق retry را تا مهلت و نه بیشتر باز می‌گذارد؛
- پرداخت در حال بررسی retry و انقضای خودکار را می‌بندد و پس از نتیجه قطعی به مسیر
  درست می‌رود؛
- callback تکراری و refresh صفحه اثر دوم ندارند؛
- موفقیت دیررس stock conflict را بدون handoff و با متن انسانی نشان می‌دهد؛
- فروشنده سفارش غیرقابل اقدام را حتی با URL مستقیم نمی‌بیند.

### RTL، دسترس‌پذیری و حریم خصوصی

- viewport موبایل و دسکتاپ بدون overflow و با ترتیب درست RTL؛
- همه قدم‌ها فقط با صفحه‌کلید، focus قابل مشاهده و بازگشت منطقی کار می‌کنند؛
- focus پس از خطا به خلاصه خطا و سپس ورودی مربوط می‌رود؛
- دکمه پرداخت نام و مبلغ روشن و target لمسی حداقل ۴۰px دارد؛
- کنتراست، متن بلند فارسی، پول و اعداد، zoom و screen reader آزموده می‌شوند؛
- `prefers-reduced-motion` حرکت غیرضروری را حذف می‌کند؛
- هیچ ورود مزاحمی پیش از ادامه برای ثبت سفارش نمایش داده نمی‌شود؛
- پاسخ، log، trace، رخداد، fixture و cache برای secret، نشانی و callback با آزمون
  privacy acceptance بررسی می‌شوند؛
- reveal فروشنده پس از بازه مجاز ماسک، دلیل‌دار، auditشده و `no-store` است.

### برش‌های پیشنهادی Issueهای ساخت

این برش‌ها پس از ادغام Spec و baseline ساخته می‌شوند. SHA پایه همه آن‌ها SHA
مشترک `origin/main` پس از ادغام baseline و سه Spec است و هنگام ایجاد Issue ثبت
می‌شود. مالکیت پیشنهادی موقت `ferpheri` و reviewer پیشنهادی `Mahaan-Amr` است؛
انتقال فقط در Issue ثبت می‌شود.

| برش                             | خروجی و فایل اصلی                                                                                          | dependency                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| قرارداد و persistence سفارش     | `@sevo/contracts/orders/v1`، fragment OpenAPI، schema/migration ماژول سفارش و تست compatibility            | baseline platform و ادغام این Spec؛ `contract-blocks` هویت/فروشگاه/کالا/موجودی |
| سبد سروری و نشانی نسخه‌دار      | API سبد، cookie secret، اتصال/حل تعارض و CRUD نشانی در `apps/api/src/modules/orders/**`                    | قرارداد و persistence سفارش                                                    |
| مرور نهایی و ساخت سفارش با fake | `PrepareCheckout.v1`، `CreateOrder.v1` و transaction با fakeهای نسخه‌دار producerها                        | قرارداد سفارش؛ schema producerها ثابت؛ implementation واقعی integration-blocks |
| قرارداد و چرخه پرداخت مستقیم    | `@sevo/contracts/payments/v1`، persistence تلاش، callback dedup، Provider توسعه و startup guard            | baseline و سفارش قابل ساخت                                                     |
| تطبیق و نهایی‌سازی اتمیک        | worker، lease recovery، نتیجه قطعی/مبهم/دیررس و `OrderBecameActionable.v1` با fake موجودی                  | قرارداد پرداخت و ساخت سفارش؛ موجودی واقعی integration-blocks                   |
| رابط سبد تا نتیجه               | routeهای خریدار، متن اعتماد، سه نتیجه و پیگیری سفارش در `apps/web/src/app/(buyer)/**`                      | APIهای سفارش/پرداخت با fake قراردادی                                           |
| نمای سفارش قابل اقدام فروشنده   | list/detail/reveal در API و `apps/web/src/app/(seller)/seller/orders/**`                                   | handoff قرارداد؛ فروشندگی و انجام سفارش واقعی integration-blocks               |
| ادغام واقعی و پذیرش سرتاسری     | اتصال کالا، موجودی، فروشگاه، هویت و انجام سفارش واقعی؛ PostgreSQL، contract، E2E، RTL و privacy acceptance | ادغام implementation همه producerها؛ هیچ fake مرز داخلی باقی نماند             |

هر Issue فقط migration و قرارداد ماژول خودش را تغییر می‌دهد. اگر baseline، schema
producer یا فایل مرکزی آماده نباشد، Issue مصرف‌کننده با fake پیش می‌رود و تنها
integration آن blocked می‌ماند؛ قرارداد تکراری یا migration موقت در ماژول
مصرف‌کننده ساخته نمی‌شود.
