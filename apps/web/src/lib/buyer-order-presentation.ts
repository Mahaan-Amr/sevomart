import type { OrderStatus } from "@sevo/contracts/orders/v1";
import type { DirectRefundStatus } from "@sevo/contracts/payments/v1";

export function presentBuyerOrderState(
  status: OrderStatus,
  refundStatus?: DirectRefundStatus,
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
  return {
    label: "پرداخت تأیید شد",
    nextStep: "فروشگاه آماده‌سازی و ارسال سفارش را ثبت می‌کند.",
  };
}
