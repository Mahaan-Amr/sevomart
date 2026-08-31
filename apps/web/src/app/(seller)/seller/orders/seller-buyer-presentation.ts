import type { StoreBuyerOrder, StoreBuyerSummary } from "@sevo/contracts/orders/v1";

export function relatedOrderId(buyer: StoreBuyerSummary) {
  return buyer.matchedOrderId ?? buyer.latestOrder.orderId;
}

export function fulfillmentLabel(
  status: StoreBuyerSummary["latestOrder"]["fulfillmentStatus"],
) {
  const labels = {
    ACTION_REQUIRED: "نیازمند اقدام",
    PREPARING: "در حال آماده‌سازی",
    SHIPPED: "ارسال‌شده",
    DELIVERED: "تحویل‌شده",
    CANCELLATION_PENDING_REFUND: "لغو در انتظار بازپرداخت",
    CANCELLED: "لغوشده",
  } as const;
  return status ? labels[status] : "هنوز شروع نشده";
}

export function paymentLabel(status: StoreBuyerOrder["paymentStatus"]) {
  const labels = {
    PENDING_PAYMENT: "در انتظار پرداخت",
    PAYMENT_REVIEW: "پرداخت در حال بررسی",
    PAID: "پرداخت‌شده",
    EXPIRED: "مهلت پرداخت تمام‌شده",
    CANCELLATION_PENDING_REFUND: "لغو در انتظار بازپرداخت",
    CANCELLED: "لغوشده",
  } as const;
  return labels[status];
}
