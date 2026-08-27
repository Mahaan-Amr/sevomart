# پیوست خصوصی گفت‌وگو

مرجع: [قرارداد و adapter رسانه خصوصی گفت‌وگو](https://github.com/Mahaan-Amr/sevomart/issues/179)
و [قرارداد گفت‌وگو](conversations-v1-contract.md).

## قرارداد و مسئولیت

`POST /v1/conversations/{conversationId}/media` برای هویت فعال و participant مجاز،
فقط `file` در multipart می‌پذیرد. purpose سمت سرور `CONVERSATION_ATTACHMENT` است؛
endpointهای رسانه فروشگاه این purpose را نمی‌پذیرند. حدهای موجود حفظ می‌شوند:
JPEG/PNG/WebP غیرمتحرک، حداکثر ۱۰ مگابایت و ۲۴ مگاپیکسل. MIME، decode و ابعاد بررسی
می‌شوند و مشتق `attachment-preview` به WebP با حداکثر ۱۶۰۰×۱۶۰۰، بدون crop/upscale
ساخته می‌شود. پردازش همگام است؛ فایل آماده‌نشده موفق گزارش نمی‌شود.

فایل اصلی و مشتق در bucket خصوصی می‌مانند. ستون قدیمی `owner_seller_id` شناسه هویت
بارگذار را نگه می‌دارد؛ نام تاریخی ستون به معنی الزام فروشندگی نیست.
`owner_reference_id` شناسه scalar همان رشته است؛ FK یا query میان‌ماژولی ندارد.

`ConversationMediaAccess` از مالک گفت‌وگو در composition تزریق می‌شود:

- بدون mediaId: بررسی دسترسی زنده participant برای upload یا پیش‌نمایش بارگذار؛
- با mediaId: همان بررسی به‌علاوه اثبات وجود پیام ثبت‌شده این فایل در همان رشته.

مالک فایل فقط با دسترسی زنده به رشته پیش‌نمایش می‌گیرد. طرف دیگر فقط بعد از ثبت
پیام فایل را می‌خواند. نبود authorizer پیش‌فرض deny است. دانستن URL یا mediaId
هیچ مجوزی ایجاد نمی‌کند. اتصال authorizer واقعی در producer گفت‌وگو انجام می‌شود؛
رسانه aggregate آن را import نمی‌کند.

`GET /v1/media/{mediaId}` مشتق را پس از authorization می‌خواند؛ پاسخ خصوصی
`Cache-Control: private, no-store` دارد. مهمان `401` و هویت نامرتبط، رشته نامرتبط یا
دسترسی لغوشده `404` می‌گیرد. هیچ پیوست گفت‌وگو از مسیر انتشار فروشگاه عمومی نمی‌شود؛
این قاعده در adapter و CHECK پایگاه داده نیز برقرار است.

## آمادگی برای ارسال

`ConversationAttachmentReader.checkConversationAttachment(input)` فقط ورودی strict
`identityId/conversationId/mediaId` و خروجی `READY | MEDIA_NOT_READY | MESSAGE_REJECTED`
دارد. owner، رشته، purpose و PRIVATE بودن دوباره بررسی می‌شوند؛ مشتق غایب
`MEDIA_NOT_READY` است. خطای ذخیره‌ساز propagate می‌شود و موفقیت کاذب نمی‌سازد.
مصرف‌کننده مسئول دسترسی زنده actor و ثبت اتمیک پیام است. object key، checksum،
metadata خام و بایت در این قرارداد نیستند. محتوا یا caption به log/outbox افزوده نمی‌شود.

## migration و سازگاری

migration مالک رسانه `20260827100000__media__conversation-attachments` پس از
`20260826090000__payments__remove-cross-module-order-fk` فقط CHECKهای purpose/variant
را گسترش و خصوصی‌ماندن و وجود زمینه پیوست را تضمین می‌کند. ستون یا جدول تازه ندارد؛
Prisma همان فیلدهای string را نگه می‌دارد. migration منتشرشده بازنویسی نمی‌شود؛ اصلاح
بعدی forward-fix است. endpoint و قراردادهای فروشگاه موجود حفظ می‌شوند؛ API جدید
افزایشی است. در OpenAPI، `401` خواندن رسانه خصوصی نیز مستند شده است.

Docker با migrate deploy هنگام startup و native با مسیر رسمی pnpm dev همان migration
و adapter را مصرف می‌کنند؛ env، پورت و dependency تازه‌ای وجود ندارد. integration
رسانه با PostgreSQL و MinIO واقعی، upload، خواندن دوطرفه پس از ارسال، منع URL مستقیم،
لغو دسترسی، آمادگی و منع عمومی‌شدن را بررسی می‌کند.
