# مشخصات کشف و دنبال‌کردن فروشگاه

این Spec برش عمودی مشاهده دو فید خریدار و دنبال‌کردن فروشگاه در نسخه اول سوو
است. قرارداد کالا، فروشگاه، موجودی و هویت را تکرار نمی‌کند و برای مالک، نسخه و
dependency آن‌ها به
[گراف قراردادها و وابستگی‌های نسخه اول](../architecture/v1-contract-dependency-graph.md)
ارجاع می‌دهد.

ورودی‌های قطعی این سند:

- [نمونه تجربه مشاهده کالا، کشف و دنبال‌کردن](https://github.com/Mahaan-Amr/sevomart/issues/52)
- [تثبیت قرارداد کالای فیزیکی، گونه و انتشار عمومی](https://github.com/Mahaan-Amr/sevomart/issues/56)
- [تثبیت قرارداد دنبال‌کردن و دو فید خریدار](https://github.com/Mahaan-Amr/sevomart/issues/58)
- [تعیین مرز سه Spec و گراف قراردادها برای کار موازی](https://github.com/Mahaan-Amr/sevomart/issues/60)
- [سیستم طراحی پایه محصول](../product/design-system.md)
- [مشخصات محصول نسخه اول](mvp-product-spec.md)
- [مشخصات ساخت و انتشار کالای فیزیکی](physical-product-authoring-and-publication.md)

## ۱. نتیجه و کار اصلی

مهمان یا خریدار کالاهای عمومی را در «کشف» با ترتیب قطعی، تازه و متنوع میان
فروشگاه‌ها می‌بیند. خریدار واردشده می‌تواند فروشگاهی را دنبال کند و کالاهای
فروشگاه‌های دنبال‌شده را در فیدی عمدتاً زمانی و قابل پیش‌بینی ادامه دهد؛ بدون
شخصی‌سازی، سیگنال محبوبیت یا افشای هویت دنبال‌کنندگان.

- **برای مهمان:** کشف، جزئیات کالا و فروشگاه بدون ورود قابل مشاهده‌اند. ورود فقط
  هنگام اقدام دنبال‌کردن یا بازکردن «دنبال‌شده‌ها» درخواست می‌شود و زمینه قبلی
  کشف را از بین نمی‌برد.
- **برای خریدار:** تغییر قیمت یا موجودی محتوای کارت را به‌روز می‌کند، اما جای کالا
  را تازه نمی‌کند. تغییر مجموعه فروشگاه‌های دنبال‌شده، پیمایش قدیمی فید شخصی را
  صریحاً نامعتبر می‌کند.
- **برای فروشنده:** فقط شمار eventual دنبال‌کنندگان فعال فروشگاه دیده می‌شود؛
  فهرست، هویت، شماره تماس و رفتار پیمایش دنبال‌کنندگان در دسترس نیست.

عمق این برش پشت سه interface مالک می‌ماند: `StoreFollowing.v1` چرخه رابطه را
پنهان می‌کند، `DiscoveryFeed.v1` و `FollowingFeed.v1` پیمایش snapshot‌شده را
می‌سازند و `PublicFollowerCount.v1` تنها seam شمار عمومی است. هیچ caller جدول یا
projection داخلی این ماژول را مستقیم نمی‌خواند.

## ۲. محدوده و خارج از محدوده

### در محدوده

- فید عمومی «کشف» برای مهمان و خریدار با نتیجه و ترتیب یکسان؛
- فید شخصی «دنبال‌شده‌ها» فقط برای هویت فعال واردشده؛
- رابطه یکتای دنبال‌کردن فروشگاه با فعال‌سازی دوباره و توقف دنبال‌کردن؛
- جلوگیری از خوددنبال‌کردن و دنبال‌کردن فروشگاه غیرمنتشرشده؛
- شمار عمومی eventual دنبال‌کنندگان بدون endpoint فهرست دنبال‌کننده؛
- projection کارت کالا و خلاصه فروشگاه از رخدادهای نسخه‌دار producerها؛
- eligibility، حذف از پیمایش پس از توقف انتشار و بازگشت پس از بازانتشار؛
- ranking قطعی، cursor مات و امضاشده، snapshot و rotation کلید؛
- رفتار مهمان، ورود در لحظه اقدام، empty state و بازگشت به زمینه قبلی؛
- ناموجودی، جزئیات authoritative و failure modeهای projection؛
- OpenAPI، رخدادهای تولیدی/مصرفی، idempotency، privacy و observability؛
- معیار آزمون و برش‌های کوچک اجرای بعدی.

### خارج از محدوده

- شخصی‌سازی، onboarding سلیقه، recommendation، embedding یا مدل یادگیری؛
- سیگنال محبوبیت مانند بازدید، پسند، ذخیره، افزودن به سبد، تبدیل یا رشد فروش؛
- حذف کالاهای فروشگاه دنبال‌شده از کشف یا رتبه بهتر برای فروشگاه دنبال‌شده؛
- تبلیغ پولی، خرید جایگاه، فروشگاه روبه‌رشد یا هر رتبه‌بندی تجاری؛
- جست‌وجو، فیلتر دسته‌بندی، hashtag، محتوای فروش و تجربه خرید؛
- دنبال‌کردن کالا، فهرست عمومی/خصوصی دنبال‌کنندگان یا export آن برای فروشنده؛
- اعلان انتشار کالای تازه، digest، پیامک، push یا ایمیل؛
- ساخت جزئیات authoritative کالا، گونه، قیمت، موجودی یا فروشگاه؛
- گفت‌وگو و اطلاعات تماس؛ این Spec فقط زمینه و اقدام ورود به route مالک آن‌ها را
  حفظ می‌کند؛
- تصمیم خرید، افزودن به سبد، رزرو موجودی یا تأیید قیمت از روی projection؛
- تغییر composer مرکزی OpenAPI، generator/datasource مرکزی Prisma، barrel مشترک
  قراردادها یا سیستم طراحی در Issueهای این مسیر.

## ۳. واژگان، actorها و مجوز

واژگان این سند همان `CONTEXT.md` است: «خریدار»، «هویت سوو»، «فروشگاه»،
«دنبال‌کردن فروشگاه»، «فید کشف»، «فید دنبال‌شده‌ها»، «کالای فیزیکی»، «نسخه
منتشرشده کالا» و «توقف انتشار کالا».

### actor و audience

| actor                    | دسترسی                                                       | نتیجه نبودن مجوز                                              |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------- |
| مهمان                    | فید کشف، فروشگاه و کالای عمومی                               | route شخصی یا write دنبال‌کردن `401 UNAUTHENTICATED`          |
| خریدار با هویت فعال      | همه دسترسی مهمان، فید دنبال‌شده‌ها و رابطه خودش              | هویت غیرفعال `403 IDENTITY_INACTIVE`                          |
| فروشنده در جایگاه خریدار | همان دسترسی خریدار، جز دنبال‌کردن فروشگاه خودش               | خوددنبال‌کردن `422 SELF_FOLLOW_NOT_ALLOWED`                   |
| فروشنده مالک فروشگاه     | فقط شمار عمومی همانند هر بازدیدکننده؛ بدون فهرست دنبال‌کننده | شناسه دنبال‌کننده یا اطلاعات تماس در هیچ پاسخ وجود ندارد      |
| worker داخلی             | مصرف رخداد و بازسازی projection با credential محدود          | credential نامعتبر `401/403` و دسترسی مستقیم عمومی وجود ندارد |

- actor از `IdentitySession.v1` و `ActorContext.v1` می‌آید. `identityId` از body،
  query یا header دلخواه پذیرفته نمی‌شود.
- `GET /v1/feeds/discovery` عمومی است و حضور نشست معتبر ترتیب یا اقلام آن را
  تغییر نمی‌دهد.
- `GET /v1/me/feeds/following` و writeهای `/me` نشست معتبر هویت فعال
  می‌خواهند. cookie منقضی یا نامعتبر در endpoint عمومی مانند نبود نشست رفتار
  می‌کند، اما در endpoint شخصی `401` است.
- public store query در صورت نشست معتبر، وضعیت همان viewer را از seam این ماژول
  ترکیب می‌کند. در نبود یا نامعتبر بودن نشست، فیلدهای viewer اصلاً در payload
  نیستند؛ پاسخ عمومی رد نمی‌شود.
- PUT فقط برای فروشگاه منتشرشده مجاز است. DELETE رابطه موجود خود خریدار حتی پس
  از توقف انتشار فروشگاه مجاز می‌ماند تا کنترل رابطه از او گرفته نشود.
- فروشگاه غیرعمومی برای فعال‌سازی `404 STORE_NOT_FOUND` می‌دهد. وجود رابطه یا
  فروشگاه خصوصی از پاسخ عمومی افشا نمی‌شود.

## ۴. جریان اصلی و شکست‌ها

### ۴.۱ کشف عمومی

1. مهمان یا خریدار «کشف» را باز می‌کند. نخستین درخواست بدون cursor،
   `snapshotAt`، روز seed و `rankingVersion` را ثابت می‌کند.
2. API حداکثر ۱۸ کارت را به‌صورت پیش‌فرض و ۳۰ کارت را در بیشترین اندازه بر اساس
   ترتیب بخش ۵ برمی‌گرداند.
3. کارت فقط خلاصه عمومی لازم برای تصمیم مشاهده را دارد: تصویر اصلی، نام و قیمت
   کالا، availability و نام/نشان/slug فروشگاه. شمار بازدید و پسند وجود ندارد.
4. انتخاب کارت، جزئیات authoritative کالا را از `ProductAuthoritativeRead.v1`
   باز می‌کند. انتخاب نام یا نشان فروشگاه مستقیماً صفحه همان فروشگاه را باز
   می‌کند؛ دکمه جداگانه «رفتن به فروشگاه» ساخته نمی‌شود.
5. `nextCursor` کلید آخر همین snapshot را حمل می‌کند. انتشار یا بازانتشار پس از
   `snapshotAt` تا refresh وارد پیمایش نمی‌شود.
6. تغییر قیمت و availability می‌تواند کارت موجود را به نسخه تازه projection
   به‌روز کند، اما کلید ranking و جای آن را تغییر نمی‌دهد.

زیر عنوان فید، `projectionUpdatedAt` با متن کوتاه «به‌روزرسانی تا …» نمایش داده
می‌شود تا تازگی read model پنهان نماند. این metadata اندازه یا ترتیب صفحه را تغییر
نمی‌دهد.

نشست، رابطه دنبال‌کردن، فروشگاه خود خریدار و رفتار قبلی او هیچ‌کدام ورودی ranking
کشف نیستند. یک cursor کشف برای مهمان و خریدار همان نتیجه را می‌دهد.

### ۴.۲ دنبال‌کردن و توقف دنبال‌کردن

1. مهمان روی «دنبال‌کردن» می‌زند؛ ورود با return context همان کالا یا فروشگاه باز
   می‌شود. لغو یا شکست ورود scroll، cursor و جزئیات جاری را حفظ می‌کند.
2. پس از ورود، client وضعیت viewer و revision رابطه را از public store composition
   می‌گیرد.
3. `PUT /v1/me/follows/{storeId}` با `Idempotency-Key` و برای رابطه موجود
   `If-Match` آن را `ACTIVE` می‌کند. ساخت رابطه نخست بدون `If-Match` مجاز است.
4. تغییر واقعی، revision رابطه و `followSetRevision` هویت را هرکدام یک واحد زیاد
   و `StoreFollowActivated.v1` را در همان transaction ثبت می‌کند.
5. تکرار PUT روی رابطه `ACTIVE` با همان یا کلید تازه موفق است، اما revision،
   شمار، زمان فعال‌شدن و رخداد تازه نمی‌سازد.
6. DELETE متناظر رابطه را `INACTIVE` و رخداد deactivation را ثبت می‌کند. تکرار
   DELETE روی رابطه `INACTIVE` نیز بدون اثر تازه موفق است.

`If-Match` گمشده برای رابطه موجود `428 PRECONDITION_REQUIRED` و revision قدیمی
`409 REVISION_CONFLICT` می‌دهد. تعارض چیزی را تغییر نمی‌دهد و پاسخ، revision جاری
قابل استفاده برای refresh را در `details` دارد. یک کلید idempotency با payload یا
precondition متفاوت `409 IDEMPOTENCY_CONFLICT` است.

### ۴.۳ فید دنبال‌شده‌ها

1. خریدار واردشده «دنبال‌شده‌ها» را باز می‌کند. نخستین پاسخ `snapshotAt` و
   `followSetRevision` جاری را در cursor ثابت می‌کند.
2. فقط کالاهای eligible فروشگاه‌های منتشرشده با رابطه `ACTIVE` در همان مجموعه
   نمایش داده می‌شوند و با ترتیب بخش ۵ پیمایش می‌شوند.
3. `visibleFollowedStoreCount` تعداد فروشگاه‌های اکنون منتشرشده با رابطه فعال برای
   هویت فعال است. این شمار، تعداد آیتم‌های فید یا شمار کل روابط تاریخی نیست.
4. مقدار صفر، راهنمای کوتاه «برای دیدن کالاهای فروشگاه‌ها، چند فروشگاه را دنبال
   کنید» و اقدام رفتن به کشف را نشان می‌دهد.
5. مقدار مثبت همراه `items: []` پیام «فعلاً کالای تازه‌ای نیست» را نشان می‌دهد؛
   رابطه‌ها یا کالاهای قدیمی حذف‌شده معرفی نمی‌شوند.
6. تغییر follow در هر tab یا دستگاه، cursor قبلی را با
   `409 FEED_CURSOR_STALE` رد می‌کند. رابط از ابتدای فید refresh می‌کند و نتیجه
   قبلی را با ادامه تازه مخلوط نمی‌کند.

جابه‌جایی میان «کشف» و «دنبال‌شده‌ها» state مستقل هر بخش شامل scroll، اقلام و
cursor بعدی را تا refresh یا خروج از صفحه حفظ می‌کند. مهمان با انتخاب
«دنبال‌شده‌ها» در همان لحظه ورود می‌خواهد؛ مشاهده کشف پیشاپیش به ورود وابسته
نیست.

### ۴.۴ صفحه کالا و فروشگاه

- نمای کالا شبیه یک پست مینیمال است: تصویر محور اصلی، نام/نشان فروشگاه و اقدام
  دنبال‌کردن در بالا؛ توضیح، قیمت، availability، گونه‌ها و شرایط ارسال در جزئیات
  authoritative پایین آن.
- صفحه فروشگاه یک پروفایل اجتماعی مینیمال با نشان، bio، شمار کالا، دنبال‌کننده و
  خرید تأییدشده، اقدام‌های هم‌اندازه دنبال‌کردن، گفت‌وگو و اطلاعات تماس و شبکه
  ۳×۳ کالاهاست. این Spec فقط شمار دنبال‌کننده و وضعیت viewer را تأمین می‌کند.
- شمار دنبال‌کننده، `updatedAt` projection را در متن دسترس‌پذیر «به‌روزرسانی تا
  …» دارد؛ عدد eventual بدون بیان تازگی به‌عنوان مقدار لحظه‌ای معرفی نمی‌شود.
- `OUT_OF_STOCK` در هر دو فید می‌ماند و با متن معمول «ناموجود» شناخته می‌شود؛
  overlay سیاه یا اقدام خرید فعال ندارد.
- قیمت و availability کارت برای راهنمایی مشاهده‌اند. جزئیات کالا و سپس سبد/سفارش
  دوباره از producer authoritative بررسی می‌شوند.
- اگر کارت به‌علت lag هنوز دیده شود اما جزئیات authoritative اکنون `404` باشد،
  رابط می‌گوید «این کالا فعلاً در دسترس نیست»، کارت را در state محلی قابل refresh
  بی‌اثر می‌کند و داده projection را به‌عنوان جزئیات جایگزین نشان نمی‌دهد.

### ۴.۵ شکست و بازیابی

| شکست                                            | رفتار قطعی سیستم                                                           | پیام و قدم بعدی رابط                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| cursor ناقص، دست‌کاری‌شده یا متعلق به feed دیگر | `400 INVALID_CURSOR`؛ هیچ query جزئی اجرا نمی‌شود                          | شروع دوباره از ابتدای همان فید                                  |
| cursor بیش از ۲۴ ساعت                           | `410 CURSOR_EXPIRED`                                                       | «فید را تازه کردیم» و refresh کامل                              |
| `rankingVersion` دیگر پشتیبانی نمی‌شود          | `409 FEED_CURSOR_STALE`                                                    | دورریختن ادامه قدیمی و refresh                                  |
| تغییر follow میان صفحه‌ها                       | `409 FEED_CURSOR_STALE`                                                    | refresh فید شخصی بدون merge دو snapshot                         |
| توقف انتشار پس از snapshot                      | tombstone جاری کالا/فروشگاه را از صفحه بعد حذف می‌کند؛ تکرار ساخته نمی‌شود | در صورت خالی‌شدن صفحه، پیمایش تا یافتن آیتم یا پایان ادامه دارد |
| بازانتشار پس از snapshot                        | `eligibleSince` تازه از snapshot جدیدتر است و وارد ادامه نمی‌شود           | فقط refresh آن را می‌آورد                                       |
| رخداد تکراری یا قدیمی                           | با `eventId` و version بی‌اثر است                                          | تغییری برای کاربر ندارد                                         |
| رخداد price/availability پیش از publication     | تا snapshot publication مرتبط buffer می‌شود                                | کارت نیمه یا حدسی ساخته نمی‌شود                                 |
| projection ناسالم یا ناسازگار                   | `503 PROJECTION_UNAVAILABLE` با `Retry-After`                              | حفظ state و اقدام «تلاش دوباره»؛ بدون نتیجه ساختگی              |
| جزئیات authoritative `404`                      | projection جای حقیقت را نمی‌گیرد                                           | پیام عدم دسترسی و بازگشت/refresh                                |
| timeout write دنبال‌کردن                        | retry همان payload با همان کلید                                            | تا پاسخ قطعی، شمار optimistic یا toast موفقیت نشان داده نمی‌شود |
| هویت پس از ورود غیرفعال شده                     | route شخصی و write `403 IDENTITY_INACTIVE`                                 | توضیح عدم دسترسی و مسیر پیگیری؛ کشف عمومی باز می‌ماند           |

## ۵. state، eligibility، ranking و transaction

### ۵.۱ state رابطه دنبال‌کردن

```text
ABSENT --PUT--> ACTIVE --DELETE--> INACTIVE --PUT--> ACTIVE
```

- کلید یکتا `identityId + storeId` است. `INACTIVE` حذف فیزیکی نمی‌شود و فعال‌سازی
  دوباره همان رابطه را با revision تازه ادامه می‌دهد.
- رابطه `status`، `revision`، `activatedAt` و `deactivatedAt` دارد. فقط transition
  واقعی زمان متناظر را عوض می‌کند.
- هر هویت یک `followSetRevision` افزایشی دارد که فقط transition واقعی هر رابطه آن
  را تغییر می‌دهد. توقف یا بازانتشار فروشگاه آن را تغییر نمی‌دهد.
- فقط هویت `ACTIVE` می‌تواند PUT کند. مالک فروشگاه از راه
  `StoreAuthoritativeRead.v1` سنجیده می‌شود و خوددنبال‌کردن ممنوع است.
- تغییر رابطه، افزایش revisionها، idempotency record و outbox همان رخداد در یک
  transaction ماژول کشف اتمیک‌اند.

### ۵.۲ eligibility و projection کارت

یک ردیف فقط وقتی eligible است که همه شرط‌های زیر از آخرین version پذیرفته‌شده
producerها برقرار باشند:

- فروشگاه در projection وضعیت `PUBLISHED` دارد؛
- کالا publication جاری `PUBLISHED` دارد؛
- snapshot عمومی یک تصویر اصلی قابل تحویل دارد؛
- publication دست‌کم یک گونه جاری دارد؛
- رخدادهای offer و availability اعمال‌شده به همان publication تعلق دارند.

موجودی مثبت شرط eligibility نیست. `OUT_OF_STOCK` فقط availability کارت و امکان
خرید را تغییر می‌دهد.

- `firstPublishedAt` در نخستین `ProductPublished.v2` پذیرفته‌شده (یا رخداد تاریخی
  `ProductPublished.v1` در پنجره سازگاری) از
  `EventEnvelope.v1.occurredAt` گرفته و برای عمر `productId` تغییرناپذیر می‌شود.
  rebuild باید از اولین رخداد همان aggregate replay شود.
- `eligibleSince` آغاز دوره جاری واجدشرایط‌بودن است. ویرایش publication، قیمت یا
  موجودی وقتی ردیف همچنان eligible است آن را تغییر نمی‌دهد. توقف انتشار دوره را
  می‌بندد و بازانتشار دوره تازه می‌سازد.
- ranking همیشه از `firstPublishedAt` استفاده می‌کند، نه `eligibleSince` یا زمان
  دریافت رخداد؛ بنابراین بازانتشار و lag consumer کالا را تازه نمی‌کنند.
- اعمال `ProductUnpublished.v1` یا `StoreUnpublished.v1` در transaction projection
  tombstone لازم را می‌نویسد؛ همه queryهای بعد از commit، آن ردیف را حتی برای
  cursor قدیمی حذف می‌کنند.
- publication یا بازانتشار فقط وقتی در snapshot دیده می‌شود که
  `eligibleSince <= snapshotAt` باشد. ردیف باید هنگام خواندن نیز هنوز eligible
  باشد؛ حذف eligibility پس از snapshot مجاز است، افزودن پس از آن مجاز نیست.
- projection آخرین `publicationVersion`، `offerVersion` و
  `availabilityVersion` را نگه می‌دارد. version قدیمی بی‌اثر و version زودرس تا
  publication مرتبط buffer می‌شود.

projection تنها داده نمایش کارت و کلید ranking را نگه می‌دارد. SKU، تعداد دقیق
موجودی، working copy، description کامل یا داده تماس در آن جایی ندارند.

### ۵.۳ ترتیب قطعی کشف

مرجع زمانی همه مرزها `snapshotAt` و تقویم UTC است. سن هر کالا فاصله روز تقویمی
UTC میان روز `firstPublishedAt` و روز snapshot است:

1. بازه تازه: سن ۰ تا ۷ روز؛
2. بازه میانی: سن ۸ تا ۳۰ روز؛
3. بازه قدیمی: سن ۳۱ روز و بیشتر.

داخل هر بازه:

1. کالاهای هر فروشگاه با `firstPublishedAt DESC, productId ASC` شماره ترتیبی
   صفرمبنا می‌گیرند؛
2. همه کالاهای شماره صفر پیش از شماره یک و به همین ترتیب می‌آیند تا فروشگاه‌ها
   دوری و متنوع نمایش داده شوند؛
3. ترتیب فروشگاه برای هر شماره با
   `HMAC(dailySeed, canonicalStoreId) ASC, storeId ASC` شکسته می‌شود؛
4. `productId ASC` آخرین tie-breaker سراسری است.

`dailySeed` یک secret روزانه server برای روز UTC نخستین درخواست است. cursor فقط
`seedDay`/شناسه کلید را حمل می‌کند، نه secret یا hash قابل استفاده مجدد. seed تا
پایان همان snapshot ثابت می‌ماند، حتی اگر پیمایش از نیمه‌شب UTC عبور کند.

کلید کامل seek کشف شامل
`freshnessBucket, storeProductOrdinal, storeHmac, storeId, firstPublishedAt,
productId` است. query بعدی فقط رکوردهای lexicographically بعد از کلید آخر را
می‌خواند؛ offset ممنوع است.

### ۵.۴ ترتیب قطعی دنبال‌شده‌ها

1. `publicationDayUtc DESC` از روز UTC `firstPublishedAt` گروه اصلی است؛
2. در هر روز، کالاهای هر فروشگاه با
   `firstPublishedAt DESC, productId ASC` شماره ترتیبی صفرمبنا می‌گیرند؛
3. شماره صفر همه فروشگاه‌ها پیش از شماره یک می‌آید؛
4. در هر شماره، `storeId ASC` و سپس `firstPublishedAt DESC, productId ASC`
   tie-breaker قطعی‌اند.

seed، محبوبیت و shuffle در فید دنبال‌شده‌ها وجود ندارد. کلید seek آن
`publicationDayUtc, storeProductOrdinal, storeId, firstPublishedAt, productId`
است. ویرایش، قیمت، availability و بازانتشار هیچ جزء این کلید را تغییر نمی‌دهند.

### ۵.۵ قرارداد cursor و snapshot

- cursor یک token base64url مات، نسخه‌دار و دارای امضای authenticated است؛ client
  به payload داخلی تکیه نمی‌کند.
- payload حداقلی شامل `feedKind`، `cursorVersion`، `rankingVersion`،
  `snapshotAt`، `expiresAt`، `pageSize`، کلید seek آخر و برای کشف `seedDay` است.
- cursor دنبال‌شده‌ها علاوه بر آن به `identityId` جاری bind و
  `followSetRevision` را حمل می‌کند. استفاده توسط هویت دیگر `INVALID_CURSOR` است.
- عمر از زمان صدور نخستین cursor دقیقاً ۲۴ ساعت است و هر صفحه expiry را تمدید
  نمی‌کند.
- اندازه صفحه ۱ تا ۳۰ است، پیش‌فرض ۱۸. cursor به اندازه صفحه bind است؛ ادامه با
  `limit` متفاوت `INVALID_CURSOR` می‌دهد.
- کلید امضای بازنشسته دست‌کم تا پایان عمر همه cursorهای صادرشده با آن برای verify
  نگه داشته می‌شود. کلید تازه فقط cursor تازه امضا می‌کند.
- هیچ payload cursor در log یا metric ثبت نمی‌شود. فقط fingerprint کوتاه غیرقابل
  برگشت، version و reason ردشدن برای عیب‌یابی مجاز است.

### ۵.۶ شمار عمومی دنبال‌کنندگان

شمار effective برابر تعداد جفت‌های یکتایی است که رابطه آن‌ها `ACTIVE`، هویتشان
`ACTIVE` و فروشگاهشان همان `storeId` است. وضعیت انتشار فروشگاه مقدار شمار را صفر
نمی‌کند؛ فروشگاه غیرمنتشرشده پاسخ عمومی ندارد و پس از بازانتشار همان روابط معتبر
دوباره دیده می‌شوند.

projection شمار برای هر رابطه آخرین revision و برای هر هویت آخرین status version
را نگه می‌دارد. هنگام هر رخداد، اثر قبلی و تازه همان جفت را در یک transaction
مقایسه و فقط delta آن را اعمال می‌کند. increment/decrement کور ممنوع است؛ رخداد
تکراری یا out-of-order شمار را تغییر نمی‌دهد و مقدار با constraint نامنفی محافظت
می‌شود.

`PublicFollowerCount.v1` مقدار و `updatedAt` آخرین commit مؤثر projection را
برمی‌گرداند. فروشگاه منبع حقیقت دوم یا cache قابل write برای این شمار ندارد.

## ۶. قراردادهای تولیدی

artifactهای مالک از `@sevo/contracts/discovery/v1` منتشر می‌شوند و با
[ردیف‌های canonical فیدها و دنبال‌کردن](../architecture/v1-contract-dependency-graph.md#جدول-canonical)
یک قرارداد واحد دارند.

### ۶.۱ OpenAPI و queryهای فید

| operationId و route                               | ورودی                     | خروجی موفق                                                           |
| ------------------------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| `getDiscoveryFeed` — `GET /v1/feeds/discovery`    | `cursor?`، `limit?`       | `items`، `nextCursor?`، `snapshotAt`، `projectionUpdatedAt`          |
| `getFollowingFeed` — `GET /v1/me/feeds/following` | نشست، `cursor?`، `limit?` | همان صفحه به‌همراه `visibleFollowedStoreCount` و `followSetRevision` |

هر item شامل `productId`، `storeId`، `storeSlug`، خلاصه نام/نشان فروشگاه، نام و
تصویر اصلی کالا، `priceRange: Money.v1`، `availability` و versionهای projection
لازم برای عیب‌یابی client است. مقدار دقیق موجودی، SKU، description کامل،
`identityId`، score یا دلیل ranking وجود ندارد.

`nextCursor` فقط وقتی نتیجه دیگری پس از حذف tombstoneها وجود دارد برگردانده
می‌شود. implementation برای پرکردن صفحه می‌تواند چند batch داخلی بخواند، اما
هرگز آیتم نامعتبر یا تکراری را صرفاً برای رسیدن به اندازه صفحه بازنمی‌گرداند.

### ۶.۲ `StoreFollowing.v1`

| operationId و route/interface                               | precondition                                   | خروجی و اثر                                                        |
| ----------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `activateStoreFollow` — `PUT /v1/me/follows/{storeId}`      | `Idempotency-Key`؛ برای رابطه موجود `If-Match` | `storeId`، `ACTIVE`، revision، `followSetRevision` و timestampها   |
| `deactivateStoreFollow` — `DELETE /v1/me/follows/{storeId}` | همان precondition                              | `storeId`، `INACTIVE`، revision، `followSetRevision` و timestampها |
| `readViewerStoreFollow` — interface درون‌پردازه‌ای          | `storeId` و actor اختیاری                      | فقط برای actor معتبر: `viewerIsFollowing` و revision رابطه         |

ETag رابطه به شکل opaque از revision ساخته می‌شود و response write و public store
composition آن را برمی‌گردانند. `identityId`، `storeId` مالک‌شده یا status هویت از
body پذیرفته نمی‌شود.

### ۶.۳ `PublicFollowerCount.v1`

interface درون‌پردازه‌ای `readPublicFollowerCount(storeIds)` برای query فروشگاه
عمومی و رابط فروشنده فقط `storeId`، مقدار نامنفی و `updatedAt` می‌دهد. operation
list، search یا export دنبال‌کنندگان وجود ندارد. batch read اجازه inference از
identity یا رابطه‌های منفرد را نمی‌دهد.

### ۶.۴ خطاهای مالک

همه خطاها `ErrorEnvelope.v1` با `code/message/correlationId/details` هستند. UI از
`code/details` متن فارسی می‌سازد و `message` سرور fallback است.

| code                      | HTTP | معنا                                                        |
| ------------------------- | ---: | ----------------------------------------------------------- |
| `INVALID_CURSOR`          |  400 | امضا، ساختار، feed، identity binding یا limit نامعتبر است   |
| `CURSOR_EXPIRED`          |  410 | ۲۴ ساعت snapshot گذشته است                                  |
| `FEED_CURSOR_STALE`       |  409 | follow set یا ranking version ادامه قبلی دیگر معتبر نیست    |
| `PROJECTION_UNAVAILABLE`  |  503 | سلامت، version gap یا freshness لازم قابل اثبات نیست        |
| `REVISION_CONFLICT`       |  409 | `If-Match` رابطه قدیمی است                                  |
| `PRECONDITION_REQUIRED`   |  428 | رابطه موجود است ولی `If-Match` ارائه نشده است               |
| `IDEMPOTENCY_CONFLICT`    |  409 | کلید قبلی با command یا precondition متفاوت استفاده شده است |
| `SELF_FOLLOW_NOT_ALLOWED` |  422 | هویت مالک همان فروشگاه است                                  |
| `IDENTITY_INACTIVE`       |  403 | هویت زنده اجازه route شخصی یا write ندارد                   |
| `STORE_NOT_FOUND`         |  404 | فروشگاه برای این operation وجود ندارد یا عمومی نیست         |
| `UNAUTHENTICATED`         |  401 | route شخصی نشست معتبر ندارد                                 |

### ۶.۵ رخدادهای تولیدی

هر رخداد `EventEnvelope.v1` با `eventId`، aggregate id/sequence، `occurredAt`،
`correlationId` و `causationId` دارد و همراه تغییر رابطه در outbox ثبت می‌شود.

| رخداد                       | payload دامنه‌ای                                   | ordering                                                     |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `StoreFollowActivated.v1`   | `storeId`، relation revision و `followSetRevision` | sequence رابطه؛ بدون `identityId` در payload عمومی event bus |
| `StoreFollowDeactivated.v1` | `storeId`، relation revision و `followSetRevision` | sequence رابطه؛ بدون PII                                     |

برای projection داخلی شمار، routing key غیرقابل نمایش یا stream partition متعلق
به مالک می‌تواند جفت رابطه را تعیین کند، اما envelope منتشرشده به مصرف‌کنندگان
دیگر هویت دنبال‌کننده را افشا نمی‌کند. consumer شمار داخل مرز ماژول به داده رابطه
مالک دسترسی دارد؛ فروشگاه و analytics چنین دسترسی‌ای ندارند.

افزودن optional سازگار در v1 مجاز است. تغییر ناسازگار با v2 کنار v1، مهاجرت
مصرف‌کنندگان و سپس حذف نسخه قدیم انجام می‌شود.

## ۷. قراردادهای مصرفی و یال‌ها

schema، state machine و invariant این قراردادها فقط نزد producer می‌ماند. این
Spec adapter مصرف یا fixture را ثبت می‌کند و قرارداد محلی هم‌نام نمی‌سازد.

| قرارداد canonical مصرفی                                                         | کاربرد                                        | یال                                        | fake و شرط integration                                      |
| ------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| platform: typed IDها، `Money.v1`، `Timestamp.v1` و envelopeهای خطا/رخداد        | cursor، کارت، idempotency و outbox            | `contract-blocks`                          | fake مجاز نیست؛ baseline نسخه‌دار پیش از ساخت               |
| هویت: `IdentitySession.v1` و `ActorContext.v1`                                  | actor اختیاری public و actor لازم `/me`       | `contract-blocks` سپس `integration-blocks` | resolver قراردادی در unit؛ نشست واقعی پیش از E2E            |
| هویت: `IdentityStatusChanged.v1`                                                | حذف contribution هویت غیرفعال از شمار         | `integration-blocks`                       | fixture versionدار؛ شمار واقعی پس از outbox هویت            |
| فروشگاه: `StoreAuthoritativeRead.v1`                                            | انتشار، مالکیت برای self-follow و خلاصه عمومی | `contract-blocks` سپس `integration-blocks` | fixture منتشر/متوقف/خودی؛ integration با read واقعی         |
| فروشگاه: `StorePublished.v1` و `StoreUnpublished.v1`                            | eligibility فروشگاه                           | `contract-blocks` سپس `integration-blocks` | fixture out-of-order؛ projection واقعی پس از outbox فروشگاه |
| کالا: `ProductAuthoritativeRead.v1`                                             | route جزئیات و fallback حقیقت                 | `contract-blocks` سپس `integration-blocks` | fixture 200/404؛ جزئیات واقعی پیش از E2E                    |
| کالا: `ProductPublished.v2`، `ProductUnpublished.v1` و `VariantPriceChanged.v1` | publication، کارت، قیمت و tombstone           | `contract-blocks` سپس `integration-blocks` | fixture versionدار؛ integration پس از outbox کالا           |
| موجودی: `VariantAvailabilityChanged.v1`                                         | availability کارت بدون مقدار دقیق             | `contract-blocks` سپس `integration-blocks` | fixture مرز صفر؛ integration پس از outbox موجودی            |
| فروشگاه عمومی ← `PublicFollowerCount.v1` و viewer follow                        | ترکیب شمار و viewer در پاسخ producer فروشگاه  | خروجی این Spec؛ `integration-blocks`       | consumer contract با spy؛ composer تک‌مالک پیش از E2E       |

- fake رخداد کالا چند کالا از یک فروشگاه، سه بازه تازگی، update price، عبور
  availability از صفر، unpublish و republish را پوشش می‌دهد.
- fake فروشگاه publish/unpublish و فروشگاه متعلق به actor را با version واقعی
  قرارداد برمی‌گرداند.
- fake هویت status فعال/غیرفعال و session اختیاری معتبر/منقضی را پوشش می‌دهد.
- fixture فقط implementation adapter است؛ نام field، error و version را تغییر
  نمی‌دهد. integration واقعی producer شرط E2E projection و شمار عمومی است.

## ۸. مالکیت داده، فایل و migration

### ۸.۱ مالکیت داده

| داده             | مالک               | نگهداری مجاز                                             | نگهداری ممنوع                                              |
| ---------------- | ------------------ | -------------------------------------------------------- | ---------------------------------------------------------- |
| رابطه دنبال‌کردن | فیدها و دنبال‌کردن | identity/store key، status، revision و timestamp         | موبایل، اطلاعات تماس، علاقه‌مندی مشتق یا دسترسی فروشنده    |
| مجموعه follow    | فیدها و دنبال‌کردن | `followSetRevision` هر identity                          | فهرست عمومی یا export برای فروشگاه                         |
| projection کارت  | فیدها و دنبال‌کردن | فیلدهای عمومی کارت، versionها، ranking key و eligibility | working copy، SKU، مقدار موجودی یا مرجع حقیقت کالا/فروشگاه |
| شمار عمومی       | فیدها و دنبال‌کردن | count، state/version لازم برای delta و updatedAt         | جدول count قابل write در فروشگاه                           |
| cursor           | فیدها و دنبال‌کردن | token امضاشده بدون persistence اجباری؛ keyring محدود     | raw cursor در log یا analytics                             |

projection rebuildپذیر است و حق پاسخ authoritative به سبد، سفارش، انتشار یا
مجوز را ندارد. drift repair از replay رخداد producer و reconcile ممیزی‌شده انجام
می‌شود؛ write مستقیم دستی به count یا eligibility مسیر عملیاتی عادی نیست.

### ۸.۲ خانواده فایل‌های Issueهای ساخت

- قرارداد کشف: `packages/contracts/src/discovery/v1/**`؛
- ماژول API: `apps/api/src/modules/discovery/**`؛
- consumer و projection worker: `apps/worker/src/modules/discovery/**`؛
- OpenAPI مالک: fragment و operations slot کشف زیر `apps/api/src/openapi/**`؛
- schema ماژول: فایل module-owned Prisma کشف پس از baseline؛
- migration:
  `packages/database/prisma/migrations/<timestamp>__discovery__*` با یک مالک؛
- رابط خریدار: `apps/web/src/app/(buyer)/discovery/**`، route فیدهای خریدار و lib
  اختصاصی همان مسیر؛
- composition فروشگاه عمومی: Issue ادغام تک‌مالک در route/lib فروشگاه موجود؛
- آزمون سرتاسری: `tests/e2e/discovery-and-store-following/**` و testهای
  integration/contract کنار مالک.

فایل‌های مرکزی `packages/contracts/package.json`، barrel مشترک، Prisma
generator/datasource، OpenAPI composer، `app.module.ts`، worker bootstrap، design
system و `module-ownership.json` فقط در baseline یا Issue ادغام تک‌مالک تغییر
می‌کنند. slot و entrypoint لازم پیش از fan-out ساخته می‌شود؛ دو شاخه هم‌زمان همان
composer، migration یا route فروشگاه را تغییر نمی‌دهند.

## ۹. PII، حریم خصوصی و observability

### ۹.۱ داده مجاز و ممنوع

- `identityId` در جدول رابطه و command شخصی لازم است، اما در پاسخ فروشنده، کارت
  عمومی، رخداد cross-module، log، trace، metric و analytics وجود ندارد.
- فروشنده فقط `followerCount` و `updatedAt` را می‌بیند. هیچ operation برای list،
  search، sample، export یا reveal دنبال‌کنندگان ساخته نمی‌شود.
- public feed برای مهمان و خریدار یکسان است؛ cache key آن به cookie، identity یا
  follow state وابسته نمی‌شود. header خصوصی باید پیش از cache عمومی حذف شود.
- following feed `Cache-Control: private, no-store` دارد. پاسخ viewer follow نیز
  عمومی cache نمی‌شود؛ بخش عمومی فروشگاه می‌تواند جدا cache شود.
- URL امضاشده رسانه، token نشست، raw cursor، کلید HMAC، mobile، IP کامل و user
  agent خام در log، metric، fixture یا event ممنوع‌اند.
- نمایش قیمت، موجودی، فروشگاه و کالا داده عمومی producer است؛ projection فقط
  حداقل همان فیلدهای لازم کارت را نگه می‌دارد.
- eventهای تحلیلی client حق ثبت `identityId + storeId/productId` به‌شکل قابل اتصال
  برای ساخت پروفایل رفتاری ندارند. سنجه عملیاتی aggregate و خصوصی است.

### ۹.۲ idempotency، audit و قابلیت پیگیری

scope idempotency برابر `operation + identityId + storeId + key` است و رکورد hash
canonical command و precondition را نگه می‌دارد:

- command یکسان: replay همان status/body و ETag؛
- command متفاوت: `IDEMPOTENCY_CONFLICT`؛
- درخواست هم‌زمان: یک winner و replay نتیجه؛ هیچ دو رخداد معنایی ساخته نمی‌شود؛
- retention رکورد حداقل تا ۲۴ ساعت و نه کوتاه‌تر از window retry client است.

audit خصوصی تغییر رابطه فقط actor داخلی، `storeId`، status/revision پیش و پس،
reason code عملیاتی، زمان و correlation را دارد. فروشنده و endpoint عمومی به audit
دسترسی ندارند. هر event `correlationId/causationId` را تا consumer projection حفظ
می‌کند.

### ۹.۳ metric و alert

metricها label دارای PII یا cardinality بالا ندارند:

- latency و نرخ خطا بر اساس `operationId/code`؛
- نرخ cursor نامعتبر/منقضی/stale بر اساس version و reason محدود؛
- page fill، عمق پیمایش داخلی و نسبت tombstone حذف‌شده بدون product/store ID؛
- lag و سن قدیمی‌ترین رخداد برای store/product/offer/availability/identity؛
- شمار buffer زودرس و version gap بر اساس event type؛
- drift و rebuild شمار عمومی، duplicate event و تلاش delta نامنفی؛
- نرخ transition follow و conflict revision به‌شکل aggregate؛ این‌ها آمار عمومی
  فروشگاه یا ابزار بازاریابی فروشنده نیستند.

alert برای projection ناسالم، version gap ماندگار، buffer حل‌نشده، lag خارج از
SLO، شکست verify کلید cursor، count drift/negative attempt و failure پیوسته
rebuild ساخته می‌شود. در نبود سلامت قابل اثبات، endpoint فید `503` می‌دهد؛ stale
data به‌عنوان موفقیت پنهان نمی‌شود.

## ۱۰. معیار پذیرش و برش Issueها

### ۱۰.۱ unit

- transitionهای `ABSENT/ACTIVE/INACTIVE`، فعال‌سازی دوباره، replay و افزایش دقیق
  relation/follow-set revision؛
- منع خوددنبال‌کردن، PUT فروشگاه غیرمنتشرشده و اجازه DELETE رابطه فروشگاه
  توقف‌انتشاریافته؛
- HMAC قطعی کشف با clock/seed تزریقی و نبود هر ورودی identity/popularity؛
- مرز UTC سه بازه در سن‌های دقیق ۷، ۸، ۳۰ و ۳۱ روز و عبور snapshot از نیمه‌شب؛
- round-robin چند کالا از چند فروشگاه و tie-break دقیق `storeId/productId`؛
- ترتیب دنبال‌شده‌ها در چند روز، نبود seed و حفظ جای کالا پس از edit/price/stock؛
- encode/decode، امضا، identity/feed/limit binding، expiry و rotation cursor؛
- تغییر follow و ranking version با `FEED_CURSOR_STALE`؛
- eligibility، دوره تازه بازانتشار و ثابت‌ماندن `firstPublishedAt`؛
- اعمال idempotent و out-of-order versionها و buffer رخداد زودرس؛
- delta شمار برای همه ترکیب‌های status رابطه/هویت، duplicate و جلوگیری از منفی.

### ۱۰.۲ integration با PostgreSQL واقعی

- دو PUT/DELETE هم‌زمان با یک اثر، revision یکتا، outbox اتمیک و replay پاسخ؛
- unique بودن `identityId + storeId` و حفظ رابطه `INACTIVE`؛
- cursor seek روی dataset چندصفحه‌ای بدون offset، duplicate یا skip در حالت پایدار؛
- unpublish پس از snapshot آیتم را از ادامه حذف و republish پس از snapshot آن را تا
  refresh پنهان می‌کند؛
- تغییر price/availability کارت را تازه و ranking key را ثابت نگه می‌دارد؛
- تغییر follow وسط پیمایش فید شخصی را stale و کشف را بی‌اثر می‌گذارد؛
- replay و out-of-order هر رخداد producer یک projection نهایی یکسان می‌سازد؛
- rebuild از event archive همان `firstPublishedAt`، eligibility و count را می‌سازد؛
- رخداد status هویت شمار را دقیقاً یک‌بار کم/زیاد و constraint مقدار نامنفی را
  حفظ می‌کند؛
- failure transaction هیچ رابطه بدون outbox یا count نیمه‌اعمال‌شده نمی‌سازد.

### ۱۰.۳ contract و compatibility

- OpenAPI چهار route، operationId، auth اختیاری/اجباری، `Idempotency-Key`،
  `If-Match`، ETag، cursor، `Retry-After` و همه error exampleها را golden-test
  می‌کند؛
- runtime contract، JSON Schema و OpenAPI برای item، page، follow view و error
  drift ندارند؛
- schema رخدادهای follow و همه رخدادهای مصرفی با `EventEnvelope.v1` validate
  می‌شوند؛
- suite consumer در برابر fake و producer واقعی فروشگاه، کالا، موجودی و هویت یکسان
  پاس می‌شود؛
- compatibility افزودن v1 و رد breaking change بدون v2 در CI بررسی می‌شود؛
- تست privacy نبود `identityId`، mobile، raw cursor، secret و popularity signal را
  در response/event/log/metric ثابت می‌کند.

### ۱۰.۴ E2E و تجربه رابط

- مهمان کشف، کالا و فروشگاه را بدون modal ورود می‌بیند؛ اقدام دنبال‌کردن ورود را
  در همان لحظه می‌خواهد و لغو آن state کشف را حفظ می‌کند؛
- پس از ورود، follow موفق دکمه و ETag را به‌روز می‌کند و refresh یا retry شمار
  دوم/رخداد دوم نمی‌سازد؛
- self-follow و فروشگاه غیرعمومی متن کوتاه و قدم بعدی درست دارند؛
- جابه‌جایی tab، scroll و cursor مستقل کشف را حفظ می‌کند؛
- empty state با صفر فروشگاه از حالت فروشگاه‌های دنبال‌شده بدون کالای eligible
  متمایز است؛
- fixture طلایی شامل سه بازه روز، چند کالای یک فروشگاه، ناموجودی، توقف/بازانتشار،
  رخداد تکراری، تغییر follow وسط پیمایش، cursor دست‌کاری‌شده و session اختیاری است
  و ترتیب دقیق همه pageها assert می‌شود؛
- تغییر قیمت/موجودی متن کارت را عوض می‌کند اما کالا را به ابتدا نمی‌برد؛
- توقف انتشار جزئیات را authoritative `404` و رابط را به پیام انسانی/refresh
  می‌رساند؛
- projection `503` state قبلی را حفظ و retry را ممکن می‌کند و داده ساختگی یا stale
  موفق نشان نمی‌دهد؛
- فروشنده فقط count/updatedAt را می‌بیند و هیچ request یا DOM راهی به هویت
  دنبال‌کننده ندارد.

### ۱۰.۵ RTL و دسترس‌پذیری

- viewport موبایل و دسکتاپ، شبکه ۳×۳، جزئیات کالا و header فروشگاه بدون overflow
  و با ترتیب RTL درست آزموده می‌شوند؛
- tabها semantic، keyboard-operable و دارای focus قابل مشاهده‌اند و بازگشت از
  جزئیات focus را به کارت آغازگر برمی‌گرداند؛
- scroll restoration مانع announcement تغییر tab و نتیجه تازه برای screen reader
  نمی‌شود؛
- دکمه دنبال‌کردن نام دسترس‌پذیر، state قابل اعلام و target لمسی حداقل ۴۰px دارد؛
- ناموجودی فقط با رنگ یا overlay فهمانده نمی‌شود؛ متن و وضعیت semantic دارد؛
- متن فارسی بلند، نام فروشگاه/کالا، اعداد و تومان، zoom و بارگذاری تصویر ناقص
  آزموده می‌شوند؛
- کنتراست focus/error مستقل از سایه است و `prefers-reduced-motion` حرکت غیرضروری
  تعویض tab و ورود کارت را حذف می‌کند؛
- skeleton دائمی، animation تزئینی و جابه‌جایی layout هنگام بارگذاری ممنوع است.

### ۱۰.۶ برش‌های پیشنهادی Issueهای ساخت

این‌ها عنوان و dependency پیشنهادی‌اند، نه Issueهای ساخته یا claim‌شده. هر Issue
پس از ادغام قبلی از SHA مشترک تازه ساخته و assignee آن ثبت می‌شود. مالک پیشنهادی
این مسیر `Mahaan-Amr` و reviewer پیشنهادی `ferpheri` است.

| برش                           | خروجی و خانواده فایل                                                                                    | dependency                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| تثبیت artifactهای v1 کشف      | `@sevo/contracts/discovery/v1`، schema follow/feed/count/error/event و contract tests                   | baseline platform و ادغام این Spec؛ schema رخدادهای هویت/فروشگاه/کالا/موجودی contract-blocks |
| persistence و چرخه دنبال‌کردن | جدول رابطه/follow-set/idempotency، PUT/DELETE، revision و outbox در `apps/api/src/modules/discovery/**` | artifact v1؛ adapter هویت/فروشگاه نسخه‌دار                                                   |
| projection شمار عمومی         | consumer رخداد follow و identity، delta idempotent و `PublicFollowerCount.v1`                           | چرخه follow؛ implementation هویت integration-blocks                                          |
| projection eligibility و کارت | consumer store/product/offer/availability، buffer version و rebuild در worker کشف                       | artifact رخداد producerها؛ outbox واقعی integration-blocks                                   |
| ranking و cursor دو فید       | queryهای PostgreSQL seek، HMAC/keyring، snapshot و golden fixtures                                      | projection با fixture نسخه‌دار؛ clock/seed تزریقی                                            |
| رابط کشف و دنبال‌شده‌ها       | tab، شبکه، state مستقل، login-on-action، empty/error state در route خریدار                              | API فید و follow؛ design system موجود                                                        |
| ادغام کالا و فروشگاه عمومی    | route جزئیات authoritative، count/viewer composition و اقدام follow با مالک تک‌فایل                     | public read واقعی کالا/فروشگاه؛ composer و route مشترک تک‌مالک                               |
| سخت‌سازی E2E، RTL و privacy   | PostgreSQL، outbox واقعی، cursor edgeها، projection failure، accessibility و عدم افشا                   | ادغام همه producerها؛ candidate ثابت و بدون fake مرز داخلی                                   |

Issue projection می‌تواند با fixture قرارداد شروع شود، اما integration و E2E آن
تا تولید واقعی `StorePublished/Unpublished.v1`، `ProductPublished.v2` و `ProductUnpublished.v1`،
`VariantPriceChanged.v1`، `VariantAvailabilityChanged.v1` و
`IdentityStatusChanged.v1` blocked می‌ماند. هیچ consumer قرارداد یا migration
موقت producer را در ماژول کشف تکرار نمی‌کند.

پیش از هر برش، PR قبلی ادغام، `origin/main` دریافت، SHA پایه در Issue ثبت و
بررسی‌های مرتبط سبز می‌شود. دو شاخه هم‌زمان schema، migration، contract entrypoint،
route فروشگاه یا فایل مرکزی یکسان را تغییر نمی‌دهند.
