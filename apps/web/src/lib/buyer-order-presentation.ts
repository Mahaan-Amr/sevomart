import type { OrderStatus } from "@sevo/contracts/orders/v1";
import type { FulfillmentTimeline } from "@sevo/contracts/fulfillment/v1";
import type { DirectRefundStatus } from "@sevo/contracts/payments/v1";

export function presentBuyerOrderState(
  status: OrderStatus,
  refundStatus?: DirectRefundStatus,
  fulfillmentStatus?: FulfillmentTimeline["status"],
): { label: string; nextStep: string } {
  if (status === "CANCELLATION_PENDING_REFUND") {
    return refundStatus === "FAILED"
      ? {
          label: "بازپرداخت نیازمند تلاش دوباره فروشگاه",
          nextStep: "فروشگاه باید بازپرداخت را دوباره ثبت کند؛ وضعیت را پیگیری کنید.",
        }
      : {
          label: "بازپرداخت در حال بررسی",
          nextStep: "نتیجه بازپرداخت را همین‌جا پیگیری کنید.",
        };
  }
  if (status === "CANCELLED") {
    return {
      label: "سفارش لغو و بازپرداخت تأیید شد",
      nextStep: "ثبت نتیجه درگاه انجام شده است؛ رسید بانکی خود را نیز نگه دارید.",
    };
  }
  if (status === "PENDING_PAYMENT") {
    return {
      label: "در انتظار پرداخت",
      nextStep: "برای حفظ رزرو، پرداخت را تا پایان مهلت سفارش انجام دهید.",
    };
  }
  if (status === "PAYMENT_REVIEW") {
    return {
      label: "نتیجه پرداخت در حال بررسی",
      nextStep: "پرداخت دوباره انجام ندهید؛ نتیجه قطعی در همین صفحه نمایش داده می‌شود.",
    };
  }
  if (status === "EXPIRED") {
    return {
      label: "مهلت پرداخت تمام شد",
      nextStep: "رزرو آزاد شده است؛ برای خرید دوباره به فروشگاه برگردید.",
    };
  }
  if (fulfillmentStatus === "DELIVERED") {
    return {
      label: "سفارش تحویل شد",
      nextStep: "اگر مشکلی هست، از همین صفحه با فروشگاه گفت‌وگو کنید.",
    };
  }
  if (fulfillmentStatus === "SHIPPED") {
    return {
      label: "سفارش ارسال شد",
      nextStep: "کد رهگیری و مسیر ارسال را بررسی کنید.",
    };
  }
  if (fulfillmentStatus === "PREPARING") {
    return {
      label: "سفارش در حال آماده‌سازی است",
      nextStep: "فروشگاه پس از ارسال، کد رهگیری را همین‌جا ثبت می‌کند.",
    };
  }
  if (fulfillmentStatus === "ACTION_REQUIRED") {
    return {
      label: "در انتظار اقدام فروشگاه",
      nextStep: "فروشگاه باید آماده‌سازی سفارش را شروع کند.",
    };
  }
  return {
    label: "پرداخت تأیید شد",
    nextStep: "فروشگاه آماده‌سازی و ارسال سفارش را ثبت می‌کند.",
  };
}
