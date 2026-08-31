# تحویل صف و پرونده تخلف پلتفرم

مرجع: [[ساخت] ساخت صف و پرونده تخلف پلتفرم](https://github.com/Mahaan-Amr/sevomart/issues/160)

مبنای اجرا `56c223dee44bc109600a41d95f7160d39781585c` و predecessor migration
`20260831090000__problem-follow-up__dispute-violation-producer` است. این تغییر
migration، dependency، متغیر محیطی، پورت یا قرارداد producer تازه ندارد و seamهای
موجود `problem-follow-up/v1` و `identity-access/v1` را مصرف می‌کند.

## مسیر و دسترسی

- `/platform/violations` فقط با مسئولیت زنده `VIOLATION_REVIEW` در route، خانه و
  ناوبری دیده می‌شود.
- صف، نوع، منبع، وضعیت و اقدام بعدی مستقل پرونده را بدون مدرک یا داده آشکارشده
  نشان می‌دهد و pagination قرارداد موجود را نگه می‌دارد.
- انتخاب پرونده به‌تنهایی داده حساس را نمی‌خواند. عامل باید شناسه اجازه فعال همان
  `VIOLATION_CASE` و دلیل ثبت‌شده را وارد کند؛ فقط سپس نمای
  `REVEALED_MINIMUM` نمایش داده می‌شود.
- دلیل فارسی برای عبور امن از header در مرورگر percent-encode و پیش از کنترل دسترسی
  و audit در API decode می‌شود تا سابقه انسانی و خوانا بماند.

## شواهد

- format، lint، architecture و typecheck کامل سبز است.
- unit برابر `219/219`، contract برابر `177/177`، integration برابر `226/226` و
  QA scenario برابر `2/2` سبز است.
- E2E متمرکز Issue در عرض‌های `360`، `390`، `768` و `1440` برابر `8/8` سبز است و
  RTL، focus، کنتراست، نبود overflow، reduced motion، نبود route/navigation بدون
  مجوز، masking پیش‌فرض و reveal ممیزی‌شده را پوشش می‌دهد.
- اجرای کامل E2E برابر `281/284` بود. سه failure خارج از این diff و مربوط به fixture
  مشترک بودند: دو مورد store-following در اجرای مستقل و تک‌worker `4/4` سبز شدند؛
  seller-conversations در نخستین viewport بدون identity seed شکست خورد و همان تست
  در سه viewport بعدی بدون تغییر کد سبز شد. این defect موجود fixture به رفتار یا
  فایل‌های Issue 160 وابسته نیست.
