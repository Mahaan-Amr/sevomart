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
- `demo:seed` فقط با `SEVO_RUNTIME_ENV=development` صریح، OTP توسعه و MinIO داخلی اجرا
  می‌شود. production، `DATABASE_URL` ارثی، provider غیرمحلی، profile نامعتبر، host یا نام
  مقصد ناشناخته و fingerprint ناسازگار پیش از نخستین write رد می‌شوند. staging علاوه بر
  fingerprint به allowlist صریح host پایگاه و MinIO نیاز دارد.
- هر اجرا زیر قفل advisory namespace `sevo.demo` انجام می‌شود. `--dry-run` همان قفل و
  validation را طی می‌کند، report شمارها را می‌دهد و receipt یا داده‌ای نمی‌نویسد.
- اجرای apply، receipt نسخه manifest و report را اتمیک ثبت می‌کند. نسخهٔ فعلی چون baseline
  دامنه‌ای هنوز در محدوده نیست، شمار `created/updated/retired/unchanged` را صفر گزارش می‌کند.

## اجرای native

یکی از دو startup رسمی را اجرا کنید تا همان `prisma migrate deploy` مشترک fingerprint را
بسازد. در مسیر native، `pnpm dev` را در یک terminal نگه دارید و از terminal دیگر fingerprint
ثبت‌شده را فقط‌خواندنی بگیرید:

```bash
pnpm demo:target -- --database-url postgresql://sevo:sevo_local@localhost:6432/sevo
```

سپس fingerprint برگشتی را عیناً به dry-run و بعد apply بدهید:

```bash
SEVO_RUNTIME_ENV=development OTP_PROVIDER=dev MINIO_ENDPOINT=127.0.0.1 pnpm demo:seed -- --profile demo --target local --database-url postgresql://sevo:sevo_local@localhost:6432/sevo --fingerprint <fingerprint> --dry-run
SEVO_RUNTIME_ENV=development OTP_PROVIDER=dev MINIO_ENDPOINT=127.0.0.1 pnpm demo:seed -- --profile demo --target local --database-url postgresql://sevo:sevo_local@localhost:6432/sevo --fingerprint <fingerprint>
```

مقدار اتصال فقط باید با `--database-url` داده شود؛ تعریف `DATABASE_URL` در shell برای این
فرمان خطاست. `demo:seed` عمداً migration اجرا نمی‌کند تا هیچ write پیش از بررسی profile،
host، fingerprint و provider رخ ندهد. خروجی JSON شامل secret یا URL اتصال نیست.

## اجرای Compose

Compose همان image پایگاه، migration ledger و script بالا را مصرف می‌کند. پس از گرفتن
fingerprint، مقدار `SEVO_DEMO_FINGERPRINT` را فقط برای همان فرمان تعیین کنید:

```bash
SEVO_DEMO_FINGERPRINT=<fingerprint> docker compose --profile demo run --rm demo-seed
```

سرویس `demo-seed` به پایان موفق سرویس `migrate` وابسته است، `DATABASE_URL` را در محیط خود
به ارث نمی‌برد و URL داخلی Compose را به‌صورت آرگومان صریح می‌گیرد.

## lifecycle پایهٔ QA

این Issue فقط محیط disposable و guardهای lifecycle را می‌سازد؛ factory دادهٔ کمینه و اتصال
آن به runnerهای سناریو در Issue `#162` می‌آید. ساخت محیط به profile و run id صریح نیاز دارد،
پورت‌های آزاد را از Docker می‌گیرد و fingerprint تازه را گزارش می‌کند:

```bash
SEVO_RUNTIME_ENV=test OTP_PROVIDER=dev pnpm qa:up -- --profile qa --run-id issue-126
```

teardown فقط با همان run id و fingerprint خوانده‌شده از همان پایگاه انجام می‌شود. mismatch
پیش از حذف container یا volume رد می‌شود:

```bash
SEVO_RUNTIME_ENV=test OTP_PROVIDER=dev pnpm qa:down -- --profile qa --run-id issue-126 --fingerprint <fingerprint>
```

`DATABASE_URL` ارثی، runtime غیر test و provider بیرونی پیش از startup رد می‌شوند. نام پروژه
Compose از run id محدود ساخته می‌شود و teardown فقط volumeهای همان پروژه را هدف می‌گیرد.

## شواهد smoke در Issue 126

در ۱۴۰۵-۰۶-۰۷ روی checkout همین شاخه:

- `pnpm dev` با پروژه و پورت‌های disposable، هر ۴۶ migration را روی پایگاه تازه اعمال کرد و
  health واقعی web، API و worker هر سه `ok` شد.
- `docker compose up --build --wait` همهٔ imageها را ساخت، همان ۴۶ migration را اعمال کرد و
  PostgreSQL، MinIO، API، worker و web به وضعیت healthy رسیدند.
- `demo:seed` در native هم dry-run و هم apply را با fingerprint واقعی اجرا کرد؛ سرویس profile
  `demo` در Compose نیز همان manifest نسخهٔ ۱ و report شمار صفر را ثبت کرد.
- `qa:up` پایگاه `sevo_qa_issue_126` را روی پورت تصادفی ساخت؛ `qa:down` با fingerprint نادرست
  حذف را رد کرد و با fingerprint درست فقط همان containerها و volumeها را حذف کرد.

## اثر قرارداد و بازگشت

قرارداد فایل manifest در نسخهٔ `v1` و receipt پایگاه ثبت شده است. این تغییر هیچ endpoint
HTTP یا رفتار client را عوض نمی‌کند، بنابراین OpenAPI تغییری ندارد. migration افزایشی است،
دادهٔ دامنه‌ای موجود را تغییر نمی‌دهد، پنجرهٔ compatibility نمی‌خواهد و اصلاح احتمالی آن
فقط با migration رو‌به‌جلو انجام می‌شود.
