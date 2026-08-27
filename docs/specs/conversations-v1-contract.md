# قرارداد نسخه اول گفت‌وگو و eligibility زمینه

وضعیت: قرارداد اجرایی برای Issue
[«تثبیت قرارداد مشترک گفت‌وگو و eligibility زمینه»](https://github.com/Mahaan-Amr/sevomart/issues/119)

مرجع محصول: [مشخصات محصول نسخه اول](mvp-product-spec.md)

## ۱. نتیجه و کار اصلی

خریدار واردشده می‌تواند گفت‌وگویی خصوصی را در زمینه یک فروشگاه منتشرشده، کالای
همان فروشگاه یا سفارش متعلق به خودش باز کند. خریدار و فروشنده سپس همان رشته را
از API مشترک و URL پایدار `conversationId` می‌خوانند و بدون ساخت پیام تکراری پاسخ
می‌دهند.

این برش فقط قرارداد نسخه‌دار، OpenAPI و آزمون سازگاری را تثبیت می‌کند. persistence،
eligibility adapterهای واقعی، upload رسانه، producer رخداد و رابط خریدار/فروشنده
در Issueهای وابسته پیاده می‌شوند.

## ۲. واژگان و invariantها

- `ConversationContextV1` یک union بسته و strict است:
  - `STORE`: فقط `storeId`؛
  - `PRODUCT`: `storeId` و `productId`؛
  - `ORDER`: `storeId` و `orderId`.
- `storeId` در هر سه حالت مرز فروشگاه را صریح می‌کند. producer باید تعلق کالا یا
  سفارش به همان فروشگاه را authoritative بررسی کند و حق استنباط از projection یا
  URL را ندارد.
- یک رشته با tuple
  `buyerIdentityId + sellerIdentityId + canonical context` یکتا است. تکرار
  `OpenConversation.v1` همان `conversationId` و thread را برمی‌گرداند.
- فقط خریدار واجد شرایط رشته تازه می‌سازد. فروشنده رشته موجود همان فروشگاه را
  می‌خواند و پاسخ می‌دهد؛ هویت دیگر یا فروشگاه دیگر حتی با URL مستقیم منع می‌شود.
- `viewerRole` فقط `BUYER | SELLER` است و از نشست و عضویت زنده محاسبه می‌شود؛
  ورودی client نیست.

## ۳. eligibility زمینه

producer گفت‌وگو aggregate فروشگاه، کالا یا سفارش را import یا query مستقیم
نمی‌کند. adapter هر مالک، `ConversationContextV1` را می‌گیرد و یکی از دو نتیجه
نسخه‌دار زیر را می‌دهد:

- `ELIGIBLE`: زمینه canonical همراه شناسه دو participant؛
- `INELIGIBLE`: یکی از `FORBIDDEN_CONTEXT`، `CONTEXT_NOT_FOUND` یا
  `CONTEXT_UNAVAILABLE`.

برای زمینه فروشگاه، فروشگاه باید منتشرشده و فروشندگی مالک فعال باشد. برای کالا،
کالا باید نسخه منتشرشده و متعلق به `storeId` باشد. برای سفارش، actor باید خریدار
همان سفارش و سفارش متعلق به `storeId` باشد. همه شکست‌های تعلق یا دسترسی در مرز
عمومی به پاسخ allow-list شده نگاشت می‌شوند و جزئیات aggregate یا هویت participant
دیگر را افشا نمی‌کنند.

## ۴. operationها و cursor

همه operationها `identitySession` می‌خواهند و برای هر درخواست وضعیت زنده هویت و
دسترسی به رشته دوباره بررسی می‌شود.

| operation                     | مسیر                                               | نتیجه                                    |
| ----------------------------- | -------------------------------------------------- | ---------------------------------------- |
| `ListConversations.v1`        | `GET /v1/conversations`                            | صفحه رشته‌های همان participant           |
| `OpenConversation.v1`         | `POST /v1/conversations`                           | رشته موجود یا تازه برای زمینه واجد شرایط |
| `ReadConversation.v1`         | `GET /v1/conversations/{conversationId}`           | زمینه و نقش viewer بدون داده تماس        |
| `ListConversationMessages.v1` | `GET /v1/conversations/{conversationId}/messages`  | صفحه پیام‌های مجاز همان رشته             |
| `SendMessage.v1`              | `POST /v1/conversations/{conversationId}/messages` | پیام ثبت‌شده با `messageId/status`       |

`cursor` مات، امضاشده و به operation، participant و snapshot همان پیمایش بسته
است و حداکثر ۲۴ ساعت اعتبار دارد. `limit` میان ۱ تا ۵۰ است. cursor ناقص، دست‌کاری
شده یا متعلق به actor/operation دیگر با `400 INVALID_CURSOR` و cursor منقضی با
`410 CURSOR_EXPIRED` رد می‌شود؛ هیچ نتیجه جزئی یا ترکیب دو snapshot برنمی‌گردد.
ترتیب رشته‌ها `updatedAt DESC, conversationId DESC` و ترتیب پیام‌ها
`createdAt DESC, messageId DESC` است و cursor همان tuple آخر را حمل می‌کند.

## ۵. ارسال idempotent و شکست قابل بازیابی

`SendMessage.v1` هدر الزامی `Idempotency-Key` دارد. scope کلید برابر
`SendMessage.v1 + actor identity + conversationId + key` است:

- payload یکسان، همان status/body و همان `messageId` را replay می‌کند؛
- payload متفاوت، `409 IDEMPOTENCY_CONFLICT` است؛
- درخواست هم‌زمان، `409 IDEMPOTENCY_IN_PROGRESS` با `Retry-After` و
  `details.retryAfterSeconds` است؛
- validation، eligibility و دسترسی پیش از ثبت نتیجه موفق انجام می‌شوند؛ retry با
  همان payload اثر دوم یا رخداد دوم نمی‌سازد.

کدهای عمومی دیگر عبارت‌اند از `UNAUTHENTICATED`، `IDENTITY_INACTIVE`،
`FORBIDDEN_CONTEXT`، `FORBIDDEN_CONVERSATION`، `CONTEXT_NOT_FOUND`،
`CONTEXT_UNAVAILABLE`، `CONVERSATION_NOT_FOUND`، `INVALID_CURSOR`،
`CURSOR_EXPIRED`، `MESSAGE_REJECTED` و `MEDIA_NOT_READY`. همه پاسخ‌ها
`version/code/message/correlationId` دارند. رابط از `code` و `details` متن فارسی و
قدم بعدی را می‌سازد و `message` سرور fallback است.

## ۶. پیام، رسانه و حریم خصوصی

پیام فقط یکی از دو محتوای strict را می‌پذیرد: متن ۱ تا ۴۰۰۰ نویسه، یا `mediaId`
به‌همراه caption اختیاری. producer واقعی باید مالکیت actor، آمادگی پردازش و نوع
مجاز رسانه را پیش از ثبت بررسی کند؛ contract آدرس object storage یا metadata خام
را حمل نمی‌کند.

نمای authenticated پیام فقط `messageId`، `conversationId`، نقش فرستنده، محتوای
نوشته/انتخاب‌شده کاربر، status و زمان دارد. شماره موبایل حساب، نشانی، روش ورود،
token، شناسه بانکی، داده سفارش حساس و شناسه داخلی participant به‌عنوان فیلد پیام
ممنوع‌اند. محتوایی که خود کاربر نوشته با داده حساب پلتفرم enrich نمی‌شود.

`MessageSent.v1` فقط `conversationId`، `messageId`، نوع زمینه و نقش فرستنده را
در payload دارد. متن، caption، `mediaId`، اطلاعات تماس و metadata رسانه در outbox،
log، trace، metric یا projection عمومی ممنوع‌اند. envelope استاندارد می‌تواند actor
داخلی را برای audit حمل کند، اما consumer عمومی payload اجازه استخراج participant
یا متن را ندارد.

## ۷. مالکیت، سازگاری و آزمون

- مالک artifact: `@sevo/contracts/conversations/v1` و fragment
  `apps/api/src/openapi/modules/conversations.ts`؛ root export، composer مرکزی،
  registry، Prisma و migration در این برش تغییر نمی‌کنند.
- افزودن optional سازگار در `v1` مجاز است. تغییر context، scope idempotency، ترتیب
  cursor، code یا payload رخداد ناسازگار است و نسخه تازه و مهاجرت مصرف‌کنندگان
  می‌خواهد.
- contract testها فقط entrypoint عمومی و OpenAPI را مصرف می‌کنند و به aggregate،
  repository یا جدول producer دسترسی ندارند.
- آزمون منفی strictness زمینه، منع فیلد تماس، payload بدون PII رخداد، نقش دو فضای
  خریدار/فروشنده، cursor، denial و هدر idempotency را پوشش می‌دهد.
- این تغییر runtime، env، port، dependency یا migration ندارد؛ بنابراین مسیرهای
  Docker و native تغییر رفتاری ندارند. producer واقعی باید هر دو مسیر را طبق قاعده
  موقت اجرای محلی دوباره بررسی کند.
