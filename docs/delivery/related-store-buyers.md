# تحویل خریداران مرتبط و reveal زمینه‌مند

مرجع: [[ساخت] ایجاد query خریداران مرتبط و reveal زمینه‌مند](https://github.com/Mahaan-Amr/sevomart/issues/136)

مبنای اجرا `8c28205` و predecessor migration
`20260830130000__identity-access__emergency-access-lifecycle` است. migration افزودنی
`20260831100000__orders__related-buyers-sensitive-audit`، audit متعلق به سفارش و
projection نمایشی وضعیت انجام را می‌سازد. dependency، متغیر محیطی و پورت تازه‌ای
اضافه نشده است.

## رفتار تحویل‌شده

- `GET /v1/seller/buyers` فقط خریداران دارای سفارش فروشگاه همان فروشنده فعال را
  برمی‌گرداند. نتیجه با نام ماسک‌شده، موبایل ماسک‌شده، شمار سفارش، آخرین سفارش و
  وضعیت انجام آن صفحه‌بندی می‌شود.
- جست‌وجو با نام گیرنده یا شماره سفارش کار می‌کند. cursor امضاشده به فروشگاه و
  عبارت جست‌وجو bind است؛ دست‌کاری یا استفاده در scope دیگر رد می‌شود. limit
  حداکثر ۵۰ است و مسیر bulk export وجود ندارد.
- `POST /v1/seller/orders/{orderId}/delivery-details/reveal` فقط سفارش پرداخت‌شده
  همان فروشگاه را باز می‌کند و همیشه دلیل انسانی می‌خواهد. این رفتار fail-closed
  است: وضعیت نمایشی دیررس یا غایب هرگز مجوز آشکارسازی بدون دلیل نمی‌سازد.
- وضعیت fulfillment از projection کمینه orders-owned رخدادهای
  `OrderBecameActionable.v1` و `FulfillmentAdvanced.v1` خوانده می‌شود؛ جدول
  fulfillment مستقیماً خوانده نمی‌شود. projection و ثبت audit در یک transaction
  قفل می‌شوند. projection فقط برای نمایش خلاصه است و منبع مجوز operational نیست.
  audit append-only است و شماره، نام، نشانی یا متن آزاد را نگه نمی‌دارد؛ فقط
  actor/store/order، کد بسته دلیل، hash دلیل، correlation و زمان ثبت می‌شوند.
- همه پاسخ‌های فهرست و reveal، شامل خطاها، `Cache-Control: no-store` دارند.

## شواهد

- contract: شکل `ListStoreBuyers.v1`، masking، سقف صفحه، ورودی reveal و OpenAPI
  canonical پوشش داده می‌شوند.
- unit: cursor سالم، دست‌کاری‌شده و scope اشتباه پوشش داده می‌شوند.
- PostgreSQL integration: جداسازی فروشگاه، جست‌وجوی نام/شماره سفارش، دو صفحه
  cursor، رد cursor و limit نامعتبر، masking، دلیل اجباری حتی با projection دیررس،
  audit بدون PII و رد دسترسی میان‌فروشگاهی پوشش داده می‌شوند.
- رابط فارسی این قابلیت در Issue مستقل 150 ساخته می‌شود؛ این تحویل route عمومی
  ناقص یا ناوبری تازه‌ای به رابط فروشنده اضافه نمی‌کند.

## بررسی راه‌اندازی

- مسیر native در ۳۱ اوت ۲۰۲۶ روی PostgreSQL و MinIO ایزوله، هر ۵۵ migration را
  اعمال کرد. `pnpm dev` سپس API، وب و worker را بالا آورد و health check هر سه
  سرویس روی پورت‌های ۳۲۰۱، ۳۲۰۰ و ۳۲۰۲ پاسخ `200` و وضعیت `ok` داد.
- ساخت مسیر رسمی Compose پیش از رسیدن به runtime، هنگام دریافت بسته‌ها از
  `registry.npmjs.org` با قطع مکرر شبکه (`ECONNRESET`) متوقف شد؛ failure مربوط به
  کد، migration یا container ثبت نشد. اجرای containerهای CI معیار نهایی این مسیر
  پیش از ادغام است.
