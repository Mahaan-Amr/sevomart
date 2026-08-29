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
- commandهای پیاده‌شده با actor، operation و `Idempotency-Key` یکتا هستند؛ replay
  همان پاسخ را می‌دهد و payload متفاوت conflict است.

## داده و سازگاری

migration `20260829140000__identity-access__platform-access-core` جدول‌های aggregate،
idempotency و audit append-only را اضافه می‌کند. جدول موجود
`identity_platform_permission_grants` projection زنده سازگار برای authorizerهای فعلی
می‌ماند و در همان transaction فعال یا لغو می‌شود. migration افزودنی است، پنجره
سازگاری نمی‌خواهد و اصلاح احتمالی فقط با forward migration انجام می‌شود.

چرخه دسترسی اضطراری عمداً در این برش نیست و Issue سازنده مستقل خودش را دارد.
