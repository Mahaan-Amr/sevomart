# manifest و harness شواهد release-critical

مرجع اجرا: [[ساخت] ایجاد manifest ماتریس شواهد و harness release-critical](https://github.com/Mahaan-Amr/sevomart/issues/165)
و تصمیم [تثبیت دروازه release-critical و ماتریس شواهد نسخه نمایشی](https://github.com/Mahaan-Amr/sevomart/issues/112).

این تحویل ادعای آمادگی production، اتصال provider واقعی یا SLA تولیدی نمی‌کند. کار آن
این است که ادعای «نسخه کامل نمایشی و آماده اتصال» را به شواهد قابل ممیزی برای SHA دقیق
نامزد محدود کند.

## قرارداد نسخه یک

- `ops/qa/release-evidence-manifest.v1.json` سه فضا، پنج هویت نمایشی، ۲۷ سفر مصوب و
  حالت‌های اجباری و شرطی هر سفر را ثبت می‌کند. هر سلول به browser، viewport، چهار لایه
  آزمون، artifact و سطح بازبینی پیوند دارد.
- `ops/qa/release-evidence-contract.v1.json` سیاست ماشین‌خوان candidate را ثابت می‌کند:
  دو اجرای تازه، صفر retry، ممنوعیت skip و quarantine، خطای قطعی console/page/network،
  بازبین مستقل و نگه‌داری ۳۰روزه.
- `scripts/qa/release-evidence.v1.mjs` plan را تولید و evidence pack تکمیل‌شده را
  fail-closed نهایی می‌کند. fingerprint دو اجرا باید متفاوت باشد؛ هر اجرا باید همان SHA،
  predecessor migration، نسخه seed و health artifactهای API، وب و worker را گزارش کند.
- `playwright.release.config.ts` فقط برای candidate است و برخلاف CI روزمره retry ندارد.
  همه سفرها در چهار viewport Chromium اجرا می‌شوند و smoke واقعی ورود و خرید در WebKit
  موبایل و دسکتاپ نیز افزوده شده است. baseline تازه به‌طور خودکار پذیرفته نمی‌شود.
- `pnpm qa:evidence:e2e` کل زنجیره unit، contract، integration و E2E نامزد را دو بار با
  زیرساخت تازه و دارای مالکیت QA اجرا می‌کند. محیط موروثی دارای اتصال پایگاه یا storage
  پذیرفته نمی‌شود. درخت کاری باید پیش و پس از اجرا و پیش از finalize پاک و روی همان SHA
  باشد. receipt فقط پس از teardown موفق نوشته می‌شود و پوشه run موجود بازنویسی نمی‌شود.
  receipt هر run، نگاشت سلول‌های manifest به فایل‌های واقعاً
  اجراشده، browserها و viewportها را حمل می‌کند و finalizer ادعای هر observation را فقط
  در صورت حضور اندازه‌گیری صریح همان سناریو و viewport می‌پذیرد؛ سبز بودن یک فایل به
  معنای پوشش همه حالت‌های آن نیست. finalizer digest گزارش مرورگر را بررسی و پوشش را
  دوباره از گزارش استخراج می‌کند. fixture خودکار
  در همه فایل‌های E2E ارجاع‌شده، console error، page error، request شکست‌خورده و تماس شبکه
  بیرونی را ثبت و همان تست را fail می‌کند. runner گزارش JSON را نیز برای skip، retry و
  نتیجه‌ای جز pass بازبینی و receipt پیوندخورده به SHA/migration/seed تولید می‌کند.
  نام پروژه مدرک موتور نیست: checkpoint نام موتور واقعی مرورگر را ثبت می‌کند و اختلاف
  آن با پروژه رد می‌شود. پروژه‌های smoke صریحاً `browserName: webkit` دارند.

## اجرای harness

ابتدا قرارداد و همه مسیرهای تست را بررسی کنید:

```bash
pnpm qa:evidence:validate
```

پس از ثبت health و startup smoke هر دو مسیر رسمی، plan را برای SHA دقیق بسازید:

```bash
pnpm qa:evidence:plan -- \
  --sha <40-character-sha> \
  --migration 20260901133000__content__public-sales-content-projection \
  --seed-version 2 \
  --health-api output/health/api.json \
  --health-web output/health/web.json \
  --health-worker output/health/worker.json \
  --startup-docker output/startup/docker.json \
  --startup-native output/startup/native.json \
  --author <github-login> \
  --output output/release-evidence/<sha>/plan.v1.json
```

runner و مرورگر باید برای هر سلول و هر اجرای candidate یک observation بسازند. تنها
`PASSED` پذیرفته است؛ `retryCount` باید صفر باشد، آرایه خطاهای غیرمنتظره console و network
خالی بماند، هر چهار artifact مرجع داشته باشند و reviewer با author متفاوت باشد. خطای عمدی
فقط در خود سناریوی خطا و به‌صورت artifact قابل ردیابی ثبت می‌شود و نباید به‌عنوان خطای
غیرمنتظره پنهان شود.
هر artifact علاوه بر `ref`، digest از نوع SHA-256 و bindingهای `runId`، `cellId`، SHA،
migration، نسخه seed و `retentionUntil` دارد. finalizer فایل را از دیسک می‌خواند و digest
و همه bindingها را دوباره بررسی می‌کند؛ مسیر خالی یا فایل دست‌کاری‌شده قابل تأیید نیست.

پس از تکمیل دو run و افزودن تأیید هر دو توسعه‌دهنده به `approvals`:

```bash
pnpm qa:evidence:finalize -- \
  --input output/release-evidence/<sha>/completed.v1.json \
  --output output/release-evidence/<sha>/approved.v1.json
```

خروجی approved، گزارش‌های تست، screenshotهای منتخب، گزارش دسترس‌پذیری، health، startup
و شواهد شکست احتمالی یک evidence pack هستند و باید تا تاریخ `retentionUntil`، دقیقاً ۳۰
روز پس از ساخت plan، نگه‌داری شوند. baselineهای قطعی تصویری همچنان در مخزن می‌مانند.

## اثر قرارداد و runtime

این harness endpoint، OpenAPI، schema پایگاه یا migration تازه ندارد. قرارداد جدید فقط
در ریل QA است. `@axe-core/playwright` فقط وابستگی توسعه برای اسکن محلی است و دلیل، مجوز
و اثر امنیتی آن در dependency register ثبت شده است. برای نصب موجود Chrome می‌توان
`SEVO_RELEASE_CHROMIUM_CHANNEL=chrome` را روی میزبان دارای Chrome نصب‌شده تنظیم کرد؛
این گزینه فقط کانال مرورگر آزمون را انتخاب می‌کند و نسخه واقعی در checkpoint ثبت می‌شود.
خود harness بر runtime محصول اثر ندارد؛ با این
حال plan بدون artifact مستقل `docker compose up --build` و `pnpm dev` نهایی نمی‌شود تا
واگرایی دو مسیر رسمی آشکار بماند.

## وضعیت ثبت شواهد بصری

کار [[ساخت] ثبت baselineهای بصری و evidence pack نسخه نمایشی](https://github.com/Mahaan-Amr/sevomart/issues/166)
هنوز کامل نشده است. `captureReleaseCheckpoint` در حالت‌های موجود تصویر منتخب با پوشاندن
ناحیه‌های حساس و گزارش خلاصه axe تولید می‌کند. اندازه viewport، reflow معادل zoom ۲۰۰٪،
RTL و بیرون‌زدگی بررسی می‌شوند. اسکن بدون HTML و متن nodeها ذخیره می‌شود. keyboard،
متن بلند، حرکت و تأیید baseline در گزارش صراحتاً `PENDING` هستند و نیاز به مرور مستقل دارند.
تصویر منتخب به معنی baseline تأییدشده نیست. تغییر snapshot در تنظیم release ممنوع است.

تصویر، trace و video خودکار شکست غیرفعال‌اند. reporter مخصوص release عنوان و متن خام
خطا، stdout، DOM و ضمیمه نامجاز را در JSON تحویلی نگه نمی‌دارد. فقط وضعیت، محل آزمون،
شمار خطاهای مرورگرِ مشاهده‌شده، اندازه‌گیری و تصویر منتخبِ متصل به digest و خلاصه axe
باقی می‌مانند. مقدار `browserActivity: null` یعنی guard مشاهده نشده، نه صفر خطا.
فایل‌های موقت خامی که خود Playwright برای شکست می‌سازد، در پایان اجرا فقط پس از بررسی
مسیر واقعی داخل پوشه همان run حذف می‌شوند؛ خطای پاک‌سازی، run را ناموفق می‌کند و مانع
receipt است. گزارش‌های قدیمی پیش از این reporter، یا پوشه اجرای قطع‌شده پیش از پایان،
خروجی قابل انتشار نیستند. خود تصویرهای منتخب هنوز به مرور مستقل محرمانگی نیاز دارند.
نگه‌داری محلی خروجی نیز جای نگه‌داری قابل دسترس ۳۰روزه را نمی‌گیرد.

شکاف‌های باز: پوشش صریح همه سلول‌های manifest، baseline و مرور مستقل همه الگوها، محدودکردن
خطاهای عمدی به رخداد مورد انتظار و مراقبت از contextهای اضافی مرورگر، بسته پاک‌سازی‌شده
قابل نگه‌داری، دو اجرای کامل روی SHA پاک و تأیید دو توسعه‌دهنده. هیچ receipt نهایی یا
تأیید انسانی برای این کار تولید نشده است.

اصلاح‌های محدود یافته‌شده در QA: ترتیب تاریخچه درخواست فروشندگی بر اساس revision و
مرحله submission/decision، به‌جای تکیه صرف بر ساعت دو پردازش؛ reflow پیش‌نمایش کالا،
رسید پرداخت، بررسی تخلف، بررسی اختلاف، بررسی درخواست فروشندگی، گزارش فروش و ناوبری
باریک خریدار؛ انتظار پایان ورود پیش از ساخت fixture گزارش فروش؛ و سنجش اندازه کنترل
فقط وقتی واقعاً نمایش داده می‌شود. آزمون مرورگر، کنترل کوچک یا صفرِ نمایش‌داده‌شده را
همچنان رد می‌کند. آزمون scroll نیز موقعیت واقعی خروج پس از نمایان‌شدن پیوند را ثبت
می‌کند و بازگشت از جزئیات کالا باید موقعیت غیرصفر و focus قبلی را برگرداند.

رابط [[ساخت] ساخت رابط محتوای فروش فروشنده](https://github.com/Mahaan-Amr/sevomart/issues/154)
در مبنای `8fa4b636ce70ac3f825515333b58a445ba6b7b9b` وجود ندارد؛ commit معرفی‌شده در
گفت‌وگوی همان تیکت (`c4e6e9e`) و شاخه آن در remote در دسترس نیستند. تست API جای شواهد
رابط این سفر را نمی‌گیرد. تا دریافت و ادغام تحویل producer، این سفر قابل تأیید نیست و
[[ساخت] اجرای نهایی دروازه release-critical نسخه نمایشی](https://github.com/Mahaan-Amr/sevomart/issues/167)
نباید به‌عنوان کار نهایی آغاز یا بسته شود.
