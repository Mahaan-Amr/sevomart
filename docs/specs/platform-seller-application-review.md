# بررسی درخواست فروشندگی توسط عامل پلتفرم

این سند قرارداد اجرایی [بررسی درخواست فروشندگی توسط عامل پلتفرم](https://github.com/Mahaan-Amr/sevomart/issues/82)
و تصمیم دسترسی عامل پلتفرم را ثبت می‌کند.

## مسئله و کار اصلی

عامل مجاز پلتفرم باید درخواست‌های ارسال‌شده را با کمترین داده لازم ببیند و یکی از دو
تصمیم «درخواست تکمیل» یا «رد» را با کد دلیل و توضیح انسانی ثبت کند. تأیید و ساخت
فروشگاه در Issue 83 باقی می‌ماند.

## دسترسی و نشست

- نشست عامل با OTP و audience مستقل `PLATFORM_AGENT` ساخته می‌شود و کوکی
  `sevo_platform_session` با `HttpOnly` و `SameSite=Strict` دارد.
- مجوز زنده `SELLER_APPLICATION_REVIEW` پیش از ارسال OTP، هنگام تأیید OTP، در مرز
  HTTP و دوباره داخل تراکنش تصمیم بررسی می‌شود. قفل اشتراکی grant مانع لغو هم‌زمان
  در میانه تصمیم است.
- اعطای نخستین مجوز فقط با فرمان عملیاتی یک‌باره زیر انجام می‌شود؛ endpoint عمومی یا
  startup hook برای آن وجود ندارد. دلیل و کلید idempotency اجباری، audit تغییرناپذیر
  و outbox اتمیک‌اند.

```sh
DATABASE_URL=... pnpm platform:permission -- --action grant \
  --identity-id <uuid> --reason "دلیل عملیاتی" --idempotency-key <uuid>

DATABASE_URL=... pnpm platform:permission -- --action revoke \
  --identity-id <uuid> --reason "دلیل لغو" --idempotency-key <uuid>
```

## صف، پرونده و تصمیم

- صف با ترتیب پایدار `lastSubmittedAt + applicationId` و cursor مات صفحه‌بندی می‌شود.
- صف فقط نام متقاضی، نام پیشنهادی فروشگاه، وضعیت، revision و زمان ارسال را برمی‌گرداند.
  شماره موبایل و متن کامل درخواست در صف نیست.
- پرونده `identityId` متقاضی را افشا نمی‌کند و فقط `isSelfReview` را برای نمایش حالت
  فقط‌خواندنی برمی‌گرداند. خودبررسی در backend نیز ممنوع است.
- هر تصمیم `expectedRevision` و `Idempotency-Key` می‌خواهد. replay همان فرمان اثر،
  audit یا event تکراری نمی‌سازد؛ رقابت بازبین‌ها با conflict پایان می‌یابد.
- مشاهده پرونده، تصمیم موفق، خودبررسی ممنوع و conflict تصمیم همگی audit هم‌بسته و
  append-only دارند. رویدادها شامل نام، متن درخواست، توضیح عمومی یا یادداشت داخلی نیستند.

## تجربه فارسی و دسترس‌پذیری

فضای کار RTL، صف فشرده و پرونده متمرکز دارد. cursor با «نمایش درخواست‌های بیشتر»
مصرف می‌شود، تمام کدهای دلیل معتبر قابل انتخاب‌اند و درخواست متعلق به عامل با پیام
واگذاری به عامل دیگر فقط‌خواندنی است. موبایل، focus صفحه‌کلید، کنتراست، overflow و
`prefers-reduced-motion` در E2E بررسی می‌شوند.

## راه‌اندازی و راستی‌آزمایی migration

پنج migration این قابلیت به ترتیب grant و audit تصمیم، ستون permission audit،
audience چالش OTP به‌همراه audit مجوز، عملیات لغو/no-op با payload hash، و scope
idempotency و actor kind فرمان عملیاتی را می‌سازند. در هر دو مسیر رسمی، همان
migrationهای Prisma اجرا می‌شوند:

- Docker: `docker compose up --build --wait`
- Native: `pnpm dev` (شامل `prisma migrate deploy`)

پس از تغییر migration، هر دو مسیر باید بالا بیایند و health API/Web، ورود عامل، صف و
صفحه بررسی پاسخ موفق بدهند.
