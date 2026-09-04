# تحویل مدرک اولیه اختلاف خریدار — Issue 231

## قرارداد و seam

- `@sevo/contracts/media/v1` شناسه opaque context، ورودی multipart و قرارداد
  نسخه‌دار بررسی آمادگی مدرک را منتشر می‌کند.
- ماژول Media فقط پس از تأیید مالکیت سفارش از راه
  `BuyerDisputeMediaAccess` یک context سی‌دقیقه‌ای می‌سازد. URL بارگذاری فقط
  شناسه context را دارد و `orderId` را افشا نمی‌کند.
- مدرک خریدار با purpose مستقل `BUYER_DISPUTE_EVIDENCE` خصوصی می‌ماند. بارگذاری
  تکراری با همان `Idempotency-Key` و همان فایل همان پاسخ را می‌دهد؛ payload
  متفاوت با همان کلید رد می‌شود. هر context حداکثر ده تصویر دارد.
- `DisputeEvidenceReader` فقط وقتی `READY` می‌دهد که هویت، سفارش، context، نوع
  تصویر، وضعیت خصوصی و preview واقعی همگی معتبر باشند. `OpenDispute.v2` هر نتیجه
  دیگری را رد می‌کند.

## migration و اجرای محلی

Migration
`20260902100000__media__buyer-dispute-evidence` دو جدول مالک Media برای context و
idempotency می‌سازد و constraint purpose/private رسانه را گسترش می‌دهد. متغیر
محیطی، پورت، dependency یا startup تازه‌ای وجود ندارد.

- مسیر Docker: `docker compose up --build --wait` migration را با همان ledger
  رسمی اجرا می‌کند و PostgreSQL و MinIO واقعی را در اختیار integration می‌گذارد.
- مسیر native: PostgreSQL و MinIO تنظیم‌شده را بالا بیاورید، سپس
  `pnpm --filter @sevo/database exec prisma migrate deploy` و `pnpm dev` را اجرا
  کنید. قرارداد runtime در هر دو مسیر یکسان است.

## آزمون و داده حساس

- unit: مالکیت پیش از صدور context، انقضا، آمادگی preview و validation consumer؛
- contract: schemaهای Media v1 و fragment کامل OpenAPI؛
- integration: PNG واقعی روی PostgreSQL/MinIO، مالک غیرمجاز، preview خصوصی،
  replay و conflict idempotency و سقف تعداد.

متن، bytes و شناسه مدرک در audit، outbox یا log عملیاتی افزوده نشده‌اند. شواهد
release نباید payload multipart یا preview خصوصی را capture کند.
