import {
  MEDIA_UPLOAD_ACCEPTED_TYPES,
  MEDIA_UPLOAD_MAX_BYTES,
} from "@sevo/contracts/media/v1";
import type { SellerProductSummary } from "@sevo/contracts/product/v1";

export type SalesContentDraft = Readonly<{
  mediaId?: string;
  productIds: readonly string[];
}>;

export function activeProductOptions(products: readonly SellerProductSummary[]) {
  return products.filter((product) => product.state === "PUBLISHED");
}

export function validateContentImage(file: File): string | undefined {
  if (file.type.startsWith("video/")) {
    return "ویدیو هنوز در سوو پشتیبانی نمی‌شود. یک تصویر JPEG، PNG یا WebP انتخاب کنید.";
  }
  if (!(MEDIA_UPLOAD_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود.";
  }
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
    return "حجم تصویر باید حداکثر ۱۰ مگابایت باشد.";
  }
}

export function validateSalesContentDraft(
  draft: SalesContentDraft,
): string | undefined {
  if (!draft.mediaId) return "یک تصویر برای محتوا انتخاب کنید.";
  const unique = new Set(draft.productIds);
  if (unique.size !== draft.productIds.length)
    return "هر کالا را فقط یک‌بار انتخاب کنید.";
  if (unique.size < 1) return "دست‌کم یک کالای فعال انتخاب کنید.";
  if (unique.size > 10) return "برای هر محتوا حداکثر ۱۰ کالا انتخاب کنید.";
}

export function contentPurchaseMessage(active: boolean) {
  return active
    ? "خرید از دست‌کم یک کالای این محتوا فعال است."
    : "خرید از این محتوا غیرفعال است؛ کالاهای پیوندشده دیگر فعال نیستند.";
}

export function sellerContentError(body: unknown, fallback: string) {
  if (typeof body !== "object" || body === null) return fallback;
  const code = "code" in body ? body.code : undefined;
  if (code === "REVISION_CONFLICT") {
    return "این محتوا جای دیگری تغییر کرده است. صفحه را تازه کنید و دوباره انجام دهید.";
  }
  if (code === "NO_ACTIVE_PRODUCT") {
    return "یکی از کالاها دیگر فعال نیست. فهرست کالاها را تازه کنید.";
  }
  if (code === "FORBIDDEN") return "اجازه انجام این کار برای این فروشگاه وجود ندارد.";
  if ("message" in body && typeof body.message === "string") return body.message;
  return fallback;
}
