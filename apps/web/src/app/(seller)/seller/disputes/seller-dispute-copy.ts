import type { DisputeStatus, SellerDispute } from "./seller-dispute-model";

export function disputeCategoryTitle(category: SellerDispute["category"]) {
  return {
    DELIVERY_NOT_RECEIVED: "سفارش به دست خریدار نرسیده",
    DAMAGED: "کالا آسیب‌دیده است",
    NOT_AS_DESCRIBED: "کالا با توضیحات هم‌خوان نیست",
    WRONG_ITEM: "کالای دیگری تحویل شده",
    REFUND_NOT_COMPLETED: "بازپرداخت کامل نشده",
  }[category];
}

export function disputeStatusTitle(status: DisputeStatus) {
  return {
    DRAFT: "ثبت‌نشده",
    SUBMITTED: "ثبت‌شده",
    AWAITING_SELLER_RESPONSE: "منتظر پاسخ فروشگاه",
    UNDER_REVIEW: "در حال بررسی سوو",
    RESOLVED: "نتیجه ثبت شده",
    CLOSED: "بسته شده",
  }[status];
}

export function evidenceKindTitle(kind: "IMAGE" | "DOCUMENT" | "MESSAGE_REFERENCE") {
  return {
    IMAGE: "تصویر",
    DOCUMENT: "سند",
    MESSAGE_REFERENCE: "پیام مرتبط",
  }[kind];
}

export function contributionAuthorTitle(author: "BUYER" | "SELLER" | "PLATFORM_AGENT") {
  return { BUYER: "خریدار", SELLER: "فروشگاه", PLATFORM_AGENT: "سوو" }[author];
}

export function formatDisputeTime(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
