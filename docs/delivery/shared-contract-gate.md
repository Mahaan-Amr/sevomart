# دروازه قراردادهای مشترک پیش از fan-out

مرجع: [[ساخت] بستن دروازه قراردادهای مشترک پیش از fan-out](https://github.com/Mahaan-Amr/sevomart/issues/122)

مبنای اجرا `3dd9103a0c2334564b12e90027d5e4a7d10070ef` و predecessor migration برابر
`20260826090000__payments__remove-cross-module-order-fk` است. این برش migration،
dependency، متغیر محیطی، پورت یا رفتار runtime تازه ندارد.

## مرجع lifecycle و مالکیت

`docs/architecture/module-ownership.json` مرجع تک‌مالک بودن ماژول، جدول و subpath
قرارداد است. `docs/architecture/contract-lifecycle.json` برای هر subpath نسخه‌دار چهار
وضعیت مستقل را ثبت می‌کند:

- `approved`: شکل و معنای قرارداد در spec یا تصمیم producer مصوب است؛
- `executable`: entrypoint دست‌کم یک schema، operation یا event واقعی و آزموده دارد؛
- `consumersMigrated`: مهاجرت مصرف‌کنندگان `complete`، `pending` یا برای قرارداد
  پیاده‌نشده `not-applicable` است؛
- `removable`: حذف همان entrypoint بدون شکستن producer، مصرف‌کننده زنده یا replay
  تاریخچه اثبات شده است.

فقط وجود فایل یا import موفق، قرارداد را قابل اجرا نمی‌کند. آزمون دروازه نام artifact
ثبت‌شده را از entrypoint واقعی resolve می‌کند؛ schema و event باید Zod قابل اجرا و
operation باید دارای `operationId`، method و path نسخه‌دار باشد. قرارداد fulfillment
در spec مصوب است اما هنوز artifact اجرایی ندارد، پس صریحاً `approved: true` و
`executable: false` ثبت شده است. notifications و reporting-analytics نیز تا زمان
تصمیم قرارداد و artifact اجرایی، ادعای آمادگی نمی‌کنند.

وضعیت compatibility artifactهای دارای چند نسخه جدا از وضعیت subpath ثبت می‌شود.
`ProductPublished.v2` قابل اجرا و مهاجرت مصرف‌کنندگان جاری آن `complete` است؛
`ProductPublished.v1` مستقل از آن `pending` و غیرقابل حذف می‌ماند، چون adapter تاریخچه
برای catch-up و rebuild هنوز لازم است. قراردادهای conversations، content و
problem-follow-up نیز تا پیاده‌سازی producer و مهاجرت مصرف‌کنندگان آینده `pending`
می‌مانند. هیچ قرارداد canonical فعلی قابل حذف اعلام نشده است.

## composition و export

- exportهای نسخه‌دار بسته قرارداد صریح‌اند و با wildcard ساخته نمی‌شوند؛ آزمون، سطح
  export را با registry مالکیت مقایسه می‌کند تا subpath بی‌مالک یا گمشده وارد نشود.
- `@sevo/contracts/api-errors/v1` مانند primitiveهای platform مالک صریح `platform`
  و lifecycle مستقل دارد و استثنای بی‌مالک سطح export نیست.
- API، OpenAPI و worker هرکدام registry قابل بازرسی `{ owner, ... }` دارند. runtime
  مستقیماً از همان registry compose می‌شود و آزمون، نبود slot، مالک تکراری و drift با
  فهرست ماژول‌های مصوب را رد می‌کند.
- `platform` فقط slot زیرساختی OpenAPI برای خطاهای مشترک دارد؛ API و worker slot دامنه
  ساختگی برای آن نمی‌سازند.

## مرز راستی‌آزمایی

تغییر composition فقط شکل ثبت همان ماژول‌ها و contributorهای موجود را عوض می‌کند و
ترتیب runtime API حفظ شده است. contract test، lifecycle، export و سه registry را
می‌سنجد؛ unit معماری، contractهای دامنه و OpenAPI موجود نیز regression رفتار سالم را
پوشش می‌دهند. چون startup، migration، env و رفتار runtime تغییر نکرده‌اند، این برش
نیازمند قرارداد تازه برای Docker یا native نیست؛ suiteهای کامل مخزن شواهد عدم drift
هستند.

نتیجه نهایی محلی در ۲۰۲۶-۰۸-۲۷: `format:check`، lint و architecture، typecheck و
build سبزند. در وضعیت نهایی مرورشده، `pnpm test` تعداد ۹۳ unit، ۱۳۱ contract و ۱۱۲
integration روی PostgreSQL را سبز کرد. E2E کامل ۱۳۴ از ۱۳۶ سناریو را سبز کرد و دو
viewport tracer هنگام انتظار projection از بودجه ۲۰ ثانیه گذشتند؛ همان tracer بلافاصله
در محیط disposable تازه و مسیر رسمی `pnpm test:e2e` در هر چهار viewport، از جمله دو
مورد ناموفق، ۴ از ۴ سبز شد. محیط‌ها همه ۴۱ migration را اعمال و سپس داده و containerهای
همان پروژه را حذف کردند. اجرای نخست پیش از integration فقط به‌دلیل در دسترس‌نبودن
Docker daemon متوقف شد و هیچ failure کد یا آزمون ثبت نکرد.
