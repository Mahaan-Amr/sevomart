# runtime امن دادهٔ نمایشی و QA

این ریل اجرایی، پایهٔ [ایجاد runtime و orchestrator امن demo و QA](https://github.com/Mahaan-Amr/sevomart/issues/126)
است. manifest نسخهٔ یک در `ops/demo/manifest.v1.json` عمداً هنوز منبع دامنه‌ای ندارد؛
factory سناریوهای QA و baseline کامل دادهٔ نمایشی در Issueهای مستقل خود افزوده می‌شوند.

## قرارداد مقصد

- migration مالک `platform` در هر پایگاه یک fingerprint تصادفی ثبت می‌کند و profile را فقط
  از نام شناخته‌شدهٔ پایگاه می‌سازد: `sevo` برای local، پیشوند `sevo_demo` برای staging و
  پیشوند `sevo_qa_` برای QA. هر نام دیگر `unknown` است و مجوز write ندارد.
- fingerprint راز نیست، اما باید برای هر اجرا از خود همان پایگاه خوانده و صریحاً بازگردانده
  شود. کپی‌کردن fingerprint محیط دیگر یا حدس‌زدن آن اجرا را متوقف می‌کند.
- `demo:seed` در production، با `DATABASE_URL` ارثی، provider غیرمحلی، profile نامعتبر،
  مقصد ناشناخته یا fingerprint ناسازگار پیش از نخستین write متوقف می‌شود.
- هر اجرا زیر قفل advisory namespace `sevo.demo` انجام می‌شود. `--dry-run` همان قفل و
  validation را طی می‌کند، report شمارها را می‌دهد و receipt یا داده‌ای نمی‌نویسد.
- اجرای apply، receipt نسخه manifest و report را اتمیک ثبت می‌کند. نسخهٔ فعلی چون baseline
  دامنه‌ای هنوز در محدوده نیست، شمار `created/updated/retired/unchanged` را صفر گزارش می‌کند.

## اجرای native

زیرساخت را بالا بیاورید و fingerprint ثبت‌شده را از مسیر فقط‌خواندنی بگیرید:

```bash
pnpm infra:up
pnpm --filter @sevo/database exec prisma migrate deploy
pnpm demo:target -- --database-url postgresql://sevo:sevo_local@localhost:6432/sevo
```

سپس fingerprint برگشتی را عیناً به dry-run و بعد apply بدهید. خود `demo:seed` پیش از اجرا
همان migration مشترک را دوباره به‌شکل idempotent اعمال می‌کند:

```bash
pnpm demo:seed -- --profile demo --target local --database-url postgresql://sevo:sevo_local@localhost:6432/sevo --fingerprint <fingerprint> --dry-run
pnpm demo:seed -- --profile demo --target local --database-url postgresql://sevo:sevo_local@localhost:6432/sevo --fingerprint <fingerprint>
```

مقدار اتصال فقط باید با `--database-url` داده شود؛ تعریف `DATABASE_URL` در shell برای این
فرمان خطاست. خروجی JSON شامل secret یا URL اتصال نیست.

## اجرای Compose

Compose همان image پایگاه، migration ledger و script بالا را مصرف می‌کند. پس از گرفتن
fingerprint، مقدار `SEVO_DEMO_FINGERPRINT` را فقط برای همان فرمان تعیین کنید:

```bash
SEVO_DEMO_FINGERPRINT=<fingerprint> docker compose --profile demo run --rm demo-seed
```

سرویس `demo-seed` به پایان موفق سرویس `migrate` وابسته است، `DATABASE_URL` را در محیط خود
به ارث نمی‌برد و URL داخلی Compose را به‌صورت آرگومان صریح می‌گیرد.

## اثر قرارداد و بازگشت

قرارداد فایل manifest در نسخهٔ `v1` و receipt پایگاه ثبت شده است. این تغییر هیچ endpoint
HTTP یا رفتار client را عوض نمی‌کند، بنابراین OpenAPI تغییری ندارد. migration افزایشی است،
دادهٔ دامنه‌ای موجود را تغییر نمی‌دهد، پنجرهٔ compatibility نمی‌خواهد و اصلاح احتمالی آن
فقط با migration رو‌به‌جلو انجام می‌شود.
