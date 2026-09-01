# اتصال قلم سفارش خریدار به ثبت تجربه خرید

مرجع اجرا: [اتصال قلم سفارش خریدار به ثبت تجربه خرید](https://github.com/Mahaan-Amr/sevomart/issues/230)

## قرارداد و مالکیت

- `BuyerOrderSnapshot.items` اکنون `orderItemId` پایدار جدول `order_items` و
  `productId` همان قلم را برمی‌گرداند.
- read جزئیات همچنان ابتدا سفارش را با `identityId` نشست محدود می‌کند؛ سفارش
  هویت دیگر `NOT_FOUND` می‌ماند و snapshot هیچ شناسه هویتی تازه‌ای منتشر نمی‌کند.
- Content فقط قرارداد authoritative موجود Orders را با همان `orderItemId` مصرف
  می‌کند و وضعیت پرداخت یا مالکیت سفارش را دوباره تفسیر نمی‌کند.
- تغییر additive است و migration یا dependency تازه ندارد؛ شناسه پایدار قلم از
  migration قبلی Orders می‌آید.

## رابط خریدار

- در جزئیات سفارش `PAID`، هر قلم اقدام «ثبت تجربه خرید» دارد که
  `orderItemId` همان قلم و `returnTo` canonical همان سفارش را به فرم می‌فرستد.
- سفارش غیر `PAID` اقدام را نشان نمی‌دهد. فرم برای قلم غیرواجدشرایط یا متعلق به
  هویت دیگر فقط پیام عمومی نمایش می‌دهد و برای قلم مصرف‌شده حالت «قبلاً ثبت شده»
  دارد.
- اقدام حداقل ارتفاع لمسی ۴۰ پیکسل، نام دسترس‌پذیر وابسته به نام کالا و چیدمان
  responsive/RTL دارد.

## راستی‌آزمایی

- contract: الزام `orderItemId`، نبود شناسه هویتی و سازگاری OpenAPI؛
- unit: parse و عبور snapshot از seam عمومی Checkout؛
- integration: خواندن `orderItemId/productId` واقعی و جلوگیری از دسترسی هویت دیگر؛
- E2E: `/orders/[orderId]` تا فرم، retry idempotent، ثبت، بازگشت canonical و حالت
  یک‌بارمصرف؛ همراه بررسی RTL، overflow موبایل و reduced motion.
