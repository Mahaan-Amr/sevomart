# تحویل رابط محتوای فروش فروشنده

این تحویل، مسیرهای `/seller/content`، `/seller/content/new` و
`/seller/content/:contentId` را به producer واقعی Content v2 و رسانه و کالای واقعی
متصل می‌کند. منبع هر مورد در رابط «فروشنده» است و ساخت یا ویرایش فقط با یک تا ده
کالای منتشرشده همان فروشگاه انجام می‌شود.

## رفتار اجرایی

- فهرست و خواندن متعلق به فروشنده با نشست هویت و فروشگاه فعال انجام می‌شود.
- تصویر JPEG، PNG یا WebP تا ۱۰ مگابایت با مسیر موجود Media بارگذاری می‌شود. runtime
  فعلی producer فقط تصویر دارد؛ رابط ویدیو را با توضیح روشن رد می‌کند و پشتیبانی
  غیرواقعی وعده نمی‌دهد.
- ویرایش تصویر و اتصال کالاها با `expectedRevision` و `Idempotency-Key` انجام می‌شود.
  تعارض هم‌زمانی و متوقف‌شدن کالا پیام بازیابی و اقدام تازه‌کردن صفحه دارند.
- رخداد توقف کالا وضعیت اتصال و اقدام خرید محتوا را غیرفعال می‌کند. انتشار دوباره
  همان محتوا رخداد نسخه‌دار می‌سازد و projection عمومی تصویر و پیوندهای تازه را
  جایگزین می‌کند، بدون تغییر زمان انتشار نخستین نسخه.

## قرارداد و داده

Content v2 سه عملیات seller list/read/replace را افزوده است. migration
`20260905100000__content__seller-sales-content-editing` ستون‌های forward-only
`revision` و `updated_at` را اضافه می‌کند. ویرایش، audit، پاسخ idempotent و outbox را
در یک transaction ثبت می‌کند. Product، Media و Store قرارداد تازه‌ای ندارند و
وابستگی تازه‌ای اضافه نشده است.

## راستی‌آزمایی

- unit: validation تصویر، ۱ تا ۱۰ کالای یکتا، فیلتر کالای فعال، پیام توقف و recovery
  تعارض؛ authorization و منطق application؛ forwarding نشست و idempotency در BFF.
- contract/OpenAPI: عملیات list/read/replace، revision و وضعیت صریح اتصال متوقف.
- integration: ساخت، فهرست، خواندن، ویرایش، تعارض revision و توقف رخدادمحور روی
  PostgreSQL واقعی؛ جایگزینی projection عمومی و حذف پیوند قدیمی.
- E2E: سفر واقعی ساخت و ویرایش با تصویر و کالای منتشرشده، در viewportهای موبایل و
  دسکتاپ، همراه focus صفحه‌کلید و reduced motion.

این تحویل migration بالا را اضافه می‌کند، اما startup و متغیر محیطی را تغییر نمی‌دهد.
مسیر native در اجرای واقعی API، web و worker و migration از صفر راستی‌آزمایی شد.
مسیر `docker compose up --build` نیز دو بار تا نصب dependencyهای image پیش رفت، اما
هر دو بار دانلود npm داخل build به‌دلیل timeout بیرونی registry قطع شد؛ سرویس‌های
زیرساخت PostgreSQL و MinIO سالم ماندند و همان migration در آزمون از صفر اعمال شد.
