# تحویل هسته اداره مجوز و دسترسی حساس

این برش Issue
[«پیاده‌سازی هسته اداره مجوز و دسترسی حساس»](https://github.com/Mahaan-Amr/sevomart/issues/127)
را روی قرارداد مصوب `@sevo/contracts/identity-access/v1` اجرا می‌کند.

## مرز اجرا

- مدیر دسترسی فقط `ACCESS_ADMINISTRATION` دارد و این مسئولیت هیچ اختیار عملیاتی
  دیگری ایجاد نمی‌کند.
- اعطای عادی مستقیم است؛ اعطای پرخطر در حالت چندمدیر در انتظار تأیید مستقل می‌ماند
  و در حالت تک‌مدیر با نشان دائمی `singleManagerException` فعال می‌شود.
- خوداعطایی و خودتأییدی رد می‌شوند. درخواست و تأیید به نشست پلتفرم با OTP حداکثر
  پنج دقیقه قبل نیاز دارند؛ لغو برای مهار به ورود تقویت‌شده تازه وابسته نیست.
- اجازه حساس به مسئولیت زنده، یک پرونده، actionهای صریح و TTL پیش‌فرض ۳۰ و حداکثر
  ۶۰ دقیقه محدود است.
- adapter تراکنشی opaque، مسئولیت و grant را در transaction تغییر حساس دوباره
  می‌سنجد و آشکارسازی را بدون کپی مقدار حساس در audit ثبت می‌کند.
- رد استفاده حساس نیز بیرون از transaction مصرف‌کننده با نتیجه `DENIED` یا
  `STOPPED_AFTER_REVOCATION` ماندگار می‌شود؛ بنابراین rollback عملیات یا لغو هم‌زمان
  سابقه تلاش را پاک نمی‌کند و mutation پس از لغو اجرا نمی‌شود.
- commandهای پیاده‌شده با actor، operation و `Idempotency-Key` یکتا هستند؛ replay
  همان پاسخ را می‌دهد و payload متفاوت conflict است.

## داده و سازگاری

migration `20260829140000__identity-access__platform-access-core` جدول‌های aggregate،
idempotency و audit append-only را اضافه می‌کند. جدول موجود
`identity_platform_permission_grants` projection زنده سازگار برای authorizerهای فعلی
می‌ماند و در همان transaction فعال یا لغو می‌شود. migration افزودنی است، پنجره
سازگاری نمی‌خواهد و اصلاح احتمالی فقط با forward migration انجام می‌شود.

migration تکمیلی
`20260830113000__identity-access__audit-unresolved-sensitive-attempts` شناسه تلاش‌شده را
از رابطه nullable با grant حل‌شده جدا می‌کند تا grant ناموجود یا با نوع نادرست نیز با
نتیجه `DENIED` و بدون نسبت‌دادن subject یا استثنای ساختگی ثبت شود. backfill تاریخچه،
تغییر constraintها و بازگرداندن trigger تغییرناپذیری زیر یک lock و در یک transaction
انجام می‌شوند؛ تست failure-injection ثابت می‌کند خطا همه تغییرها را rollback می‌کند.
شکل `PlatformAccessAuditPage` نسخه اول ثابت مانده و اصلاح بعدی فقط forward است.

چرخه دسترسی اضطراری عمداً در این برش نیست و Issue سازنده مستقل خودش را دارد.

## شواهد اجرای محلی

در ۲۹ اوت ۲۰۲۶ هر دو مسیر پشتیبانی‌شده روی محیط‌های خالی و جدا بررسی شدند:

- `pnpm dev` هر ۴۷ migration را اعمال کرد و API، وب و worker آماده شدند؛ endpointهای
  جدید دسترسی پلتفرم نیز در startup ثبت شدند.
- `docker compose up --build --wait` imageهای migrate، API، وب و worker را از نو
  ساخت، migrationها را روی PostgreSQL خالی اعمال کرد و سلامت PostgreSQL، MinIO، API،
  وب و worker را تأیید کرد.
- integration test رقابت چندمدیر میان تأیید و لغو و رقابت تک‌مدیر میان استفاده حساس
  و لغو را با قفل واقعی PostgreSQL می‌آزماید؛ در هر دو مسیر لغو اختیار زنده را باقی
  نمی‌گذارد.

پورت‌های موقت فقط برای جلوگیری از تداخل با محیط توسعه فعال استفاده و پس از بررسی
پاک شدند؛ قرارداد پورت یا متغیر محیطی محصول تغییر نکرد.

در ۳۰ اوت ۲۰۲۶ migration تکمیلی audit نیز روی دو محیط disposable تازه بررسی شد:

- `docker compose up --build --wait` هر چهار image را از candidate نهایی ساخت، هر ۵۰
  migration را اعمال کرد و PostgreSQL، MinIO، API، وب و worker همگی healthy شدند.
- `pnpm dev` همان ۵۰ migration را روی پایگاه تازه اعمال کرد؛ health checkهای API، وب
  و worker هر سه `ok` برگرداندند.

هر دو محیط با نام پروژه و پورت‌های مستقل اجرا و همراه volumeهای موقت پاک شدند.
