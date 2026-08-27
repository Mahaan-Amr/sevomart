# تثبیت قرارداد خواندن و رخدادهای فروشگاه

مرجع: [[ساخت] تثبیت قرارداد خواندن و رخدادهای فروشگاه](https://github.com/Mahaan-Amr/sevomart/issues/116)

مبنای اجرا: `3fc4806d30f571fa435dbde17ae79f64144c505b`؛ predecessor migration:
`20260826090000__payments__remove-cross-module-order-fk`.
این برش migration، dependency، متغیر محیطی، پورت یا مسیر تازه ندارد.

## قرارداد قابل اجرا

مرجع شکل داده `@sevo/contracts/store/v1` است. schemaهای خواندن داخلی، نتیجه
فعال‌بودن فروشندگی، خطاهای داخلی و سه رخداد در OpenAPI نیز منتشر می‌شوند؛
مثال‌های معتبر در بسته قرارداد موجودند. ثبت schema داخلی به معنی ایجاد
endpoint عمومی برای آن نیست.

- `StoreAuthoritativeSnapshotV1`: شناسه، مالک، slug، هویت نمایشی، revision،
  publicationVersion، وضعیت انتشار، روش‌های ارسال و سیاست مرجوعی نسخه‌دار و
  نوع/وضعیت تسویه آزمون‌شده؛ بدون داده بانکی یا آمار خصوصی.
- `sellerAccess.active`: نتیجه زنده `SellerAccessRead.isActiveSeller` از
  identity-access است. فروشگاه چرخه مجوز دیگری نمی‌سازد و وضعیت‌های
  تعلیق/لغو یا نبود مجوز را از روی `false` حدس نمی‌زند. این فیلد فقط در خواندن
  داخلی است؛ پاسخ HTTP عمومی و رخداد آن را حمل نمی‌کنند.
- فیلد `sellerAccess` برای سازگاری v1 اختیاری است؛ نبود آن به معنی مجوز فعال
  نیست. composition واقعی API همیشه reader هویت را متصل می‌کند. reader قدیمی
  یا fixture بدون این وابستگی همچنان snapshot قبلی را می‌دهد. خطای reader
  هویت منتشر می‌شود و به نتیجه ساختگی تبدیل نمی‌شود.
- خواندن با شناسه، مالک و slug همان interfaceهای موجود را نگه می‌دارد؛ نتیجه
  پیدا‌نشدن `undefined` است. `requireOwnership` عضویت و `requireSellable` وضعیت
  انتشار/تسویه متعلق به فروشگاه را بررسی می‌کنند. `requireOwnedSellable` هر دو
  را بررسی می‌کند. خطاهای پایدار `STORE_OWNERSHIP_REQUIRED` و
  `STORE_NOT_SELLABLE` با `storeId` در `StoreAuthoritativeReadErrorV1` آمده‌اند.
- احراز مجوز عامل جای این بررسی‌ها نیست؛ مصرف‌کننده عملیات حساس همچنان باید
  از قرارداد زنده مجوز هویت استفاده کند. این برش lifecycle و guardهای مسیر
  فروشنده را بازسازی نمی‌کند.

## سازگاری و ثبات

- پاسخ‌های HTTP، URLها، status codeها و فیلدهای الزامی مصرف‌شده تغییر نمی‌کنند.
- `StorePublished.v1` قدیمی بدون `payload.publicationVersion` همچنان پذیرفته
  می‌شود؛ producer کنونی این فیلد را همیشه منتشر می‌کند. حذف این compatibility
  فقط پس از اثبات مهاجرت همه مصرف‌کنندگان ممکن است.
- `StoreUnpublished.v1` آخرین publicationVersion را نگه می‌دارد؛ بازانتشار
  publicationVersion تازه می‌گیرد. aggregateVersion همان revision فروشگاه است.
- `StorePolicyChanged.v1` فقط شناسه و revision سیاست/ارسال را حمل می‌کند، نه متن
  سیاست، نشانی، شماره تماس یا مقصد تسویه.
- رخداد و mutation فروشگاه در transaction موجود outbox ثبت می‌شوند؛ replay
  همان درخواست revision یا رخداد تازه نمی‌سازد. تحویل حداقل یک‌بار است و
  مصرف‌کننده باید idempotent باشد.
- `sellerAccess` بخشی از revision یا ETag فروشگاه نیست و همراه row فروشگاه در
  یک snapshot تراکنشی مشترک با هویت خوانده نمی‌شود. خواندن تراکنشی موجود، قفل
  row فروشگاه را نگه می‌دارد؛ مشاهده مجوز یک query مستقل و زنده است. از snapshot
  ذخیره‌شده یا cache برای اجازه اقدام بعدی استفاده نمی‌شود.

## مرز ظاهر و اعتماد

`displayIdentity` فقط نام، معرفی، شناسه رسانه لوگو/جلد و رنگ هویتی را دارد.
قیمت، موجودی، کنترل خرید و trust در آن پذیرفته نمی‌شوند. ورودی فعلی، فیلد
ناشناخته را حذف می‌کند و امکان خاموش‌کردن نشان سوو نمی‌دهد. خروجی عمومی
`platformBrandingRequired: true` را الزام می‌کند و مالک، مجوز، اطلاعات بانکی و
آمار خصوصی را حذف می‌کند. قلم/ترتیب بخش‌های آینده یا UI تازه در این برش نیست.

## شواهد آزمون

- contract: خواندن سرویس واقعی، خطا و نبود منبع، فعال/غیرفعال‌شدن reader، خطای
  reader، payload قدیمی، نسخه نامعتبر، allow-list رخداد و مرز شخصی‌سازی.
- OpenAPI: ثبت schemaهای داخلی و رخداد بدون افزودن endpoint مالک؛ حفظ سطح HTTP
  قبلی و به‌روزرسانی hash فقط برای schemaهای افزوده‌شده.
- PostgreSQL: انتشار، replay، توقف و بازانتشار، تطبیق envelopeهای واقعی outbox؛
  مشاهده مجوز فعال/تعلیق/لغو بدون تغییر revision فروشگاه و خواندن تراکنشی.
- مسیر native از runnerهای رسمی تست و مسیر Docker با Compose همان کد بررسی
  می‌شوند؛ فایل‌های مرکزی runtime و تست تغییر نمی‌کنند.

نتیجه اجرای محلی در ۲۰۲۶-۰۸-۲۷: `pnpm test` سبز با ۹۳ unit، ۹۱ contract،
۱۱۰ integration و ۱۳۶ E2E؛ `format:check`، `lint`، `typecheck` و `build` نیز
سبزند. بررسی E2E چهار viewport و حالت‌های RTL، keyboard، کنتراست و reduced
motion موجود را بدون تغییر baseline گذراند. هر دو محور مرور مستقل Standards
و Spec بدون یافته قابل اقدام بودند.

ساخت کامل Compose محلی هنگام دریافت pnpm از `registry.npmjs.org` به خطای شبکه
`ECONNRESET` خورد؛ درخواست مستقیم از host نیز timeout شد. این failure قبل از
کامپایل کد پروژه است. نتیجه ساخت image و smoke در CI به Issue پیوست می‌شود؛
موفقیت آزمون native به‌جای موفقیت ساخت container گزارش نمی‌شود.

مرور انسانی نهایی و هماهنگی مصرف‌کنندگان با ferpheri است. تکمیل producer و UI
در [[ساخت] تکمیل producer راه‌اندازی و انتشار فروشگاه](https://github.com/Mahaan-Amr/sevomart/issues/130)
و Issueهای وابسته باقی می‌ماند.
