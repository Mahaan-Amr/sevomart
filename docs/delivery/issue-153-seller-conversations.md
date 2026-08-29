# تحویل فهرست و رشته گفت‌وگوی فروشنده

مرجع: [[ساخت] ساخت فهرست و رشته گفت‌وگوی فروشنده](https://github.com/Mahaan-Amr/sevomart/issues/153)

مبنای شروع اجرا `73e0b7ab64ae8a003e786635c8b6fe2b7c5b40d4` و مبنای همگام‌سازی
نهایی `1ba1f4e42258c90c0d5cb1548a8be11c2b45b49f` است. predecessor migration برابر
`20260829130000__inventory__audited-authoring` است. این برش migration، dependency،
متغیر محیطی یا پورت runtime تازه ندارد.

## مسیرها و رفتار فروشنده

- `/seller/conversations` فهرست خصوصی رشته‌های همان participant را با ترتیب قطعی
  producer و cursor مات نمایش می‌دهد. `/seller/conversations/{conversationId}`
  رشته canonical را می‌خواند و پاسخ را در همان زمینه ثبت می‌کند.
- خانه فروشنده فقط وقتی producer نتیجه `ACTIONABLE` بدهد به نزدیک‌ترین رشته نیازمند
  پاسخ پیوند می‌دهد. `GET /v1/conversations/needs-reply` این تصمیم را با یک query
  producer-owned می‌گیرد؛ وب دیگر صفحه‌های رشته و آخرین پیام تک‌تک آن‌ها را اسکن
  نمی‌کند.
- endpoint خلاصه فقط رشته‌ای را برمی‌گرداند که participant فروشنده آن actor است و
  آخرین پیام ثبت‌شده‌اش از خریدار آمده است. ترتیب `updatedAt DESC, conversationId
  DESC` نزدیک‌ترین نتیجه را قطعی می‌کند. نبود نتیجه با `NONE` نسخه‌دار نمایش داده
  می‌شود.
- دسترسی live identity، مالکیت فروشگاه و فروشندگی فعال در producer دوباره بررسی
  می‌شوند. URL فروشگاه دیگر، رشته حذف‌شده یا دسترسی ازدست‌رفته داده خصوصی افشا
  نمی‌کند و رابط یک راه بازگشت روشن به فهرست دارد.
- پاسخ متن یا تصویر ابتدا optimistic نمایش داده می‌شود. شکست، همان محتوا و همان
  `Idempotency-Key` را برای تلاش دوباره نگه می‌دارد؛ replay موفق پیام یا رخداد دوم
  نمی‌سازد. تصویر نامعتبر پیش از persistence با متن انسانی رد می‌شود.

## قرارداد، proxy و حریم خصوصی

- `ConversationNeedsReplyV1` یک union بسته با دو حالت `ACTIONABLE` و `NONE` است.
  operation نسخه اول `readConversationNeedsReply` در قرارداد مشترک و OpenAPI ثبت
  شده و پاسخ آن مانند همه readهای گفت‌وگو `private, no-store` است.
- proxy مشترک خریدار و فروشنده فقط مسیرهای collection، `needs-reply`، رشته، پیام و
  upload رسانه را allow-list می‌کند؛ شناسه‌ها با contract عمومی validate می‌شوند و
  query cursor و هدر idempotency بدون cache شدن داده خصوصی عبور می‌کنند.
- نمایش attachment از route احرازشده رسانه می‌گذرد و producer در هر بار دسترسی،
  participant زنده و تعلق media به پیام همان رشته را بررسی می‌کند.
- پورت‌های E2E فقط با متغیرهای اختیاری test قابل ایزوله‌سازی‌اند؛ مقادیر رسمی
  `3108/3109/3110` و مسیرهای native و Compose تغییر نکرده‌اند.

## شواهد و مرور

- contract و OpenAPI، نتیجه actionable/none و ثبت schema جدید را بررسی می‌کنند.
- integration روی PostgreSQL واقعی ثابت می‌کند query producer رشته‌ای را انتخاب
  می‌کند که آخرین پیامش از خریدار است و پس از پاسخ فروشنده نتیجه `NONE` می‌شود.
- unit وب ثابت می‌کند خانه فروشنده خلاصه را با دقیقاً یک درخواست می‌خواند و payload
  نامعتبر را به empty inbox تبدیل نمی‌کند.
- E2E اختصاصی در چهار viewport پاسخ متن و رسانه، replay بدون اثر دوم، رسانه
  نامعتبر، دسترسی میان‌فروشگاهی، رشته حذف‌شده، RTL، focus، کنتراست، متن بلند و
  reduced motion را پوشش می‌دهد.
- مرور اصلاحی Mahaan دو finding مربوط به N+1 و نبود delivery record را ثبت کرد؛
  read-model producer-owned و همین سند مستقیماً آن دو finding را می‌بندند.

