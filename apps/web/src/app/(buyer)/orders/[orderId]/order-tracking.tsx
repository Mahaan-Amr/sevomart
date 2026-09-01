"use client";

import {
  buyerOrderSnapshotContract,
  type BuyerOrderSnapshot,
} from "@sevo/contracts/orders/v1";
import {
  directPaymentAttemptContract,
  directRefundContract,
  type DirectRefund,
} from "@sevo/contracts/payments/v1";
import {
  fulfillmentTimelineContract,
  type FulfillmentTimeline,
} from "@sevo/contracts/fulfillment/v1";
import { buyerDisputePageContract } from "@sevo/contracts/problem-follow-up/v1";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatIrrAsToman } from "../../../../lib/format-money";
import { presentBuyerOrderState } from "../../../../lib/buyer-order-presentation";
import styles from "./order-tracking.module.css";

type BuyerDispute = ReturnType<typeof buyerDisputePageContract.parse>["items"][number];

export function OrderTracking({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<BuyerOrderSnapshot>();
  const [fulfillment, setFulfillment] = useState<FulfillmentTimeline>();
  const [refund, setRefund] = useState<DirectRefund>();
  const [dispute, setDispute] = useState<BuyerDispute>();
  const [error, setError] = useState<"SIGNED_OUT" | "NOT_FOUND" | "UNAVAILABLE">();
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(`/api/orders/${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          if (active) setError("SIGNED_OUT");
          return;
        }
        if (response.status === 404) {
          if (active) setError("NOT_FOUND");
          return;
        }
        const parsed = buyerOrderSnapshotContract.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error("order unavailable");
        if (active) setOrder(parsed.data);
        await Promise.all([
          optionalRead(
            `/api/orders/${encodeURIComponent(orderId)}/fulfillment`,
            fulfillmentTimelineContract,
          ).then((value) => active && value && setFulfillment(value)),
          optionalRead(
            `/api/orders/${encodeURIComponent(orderId)}/direct-refund`,
            directRefundContract,
          ).then((value) => active && value && setRefund(value)),
          optionalRead("/api/buyer/disputes?limit=25", buyerDisputePageContract).then(
            (value) =>
              active &&
              value &&
              setDispute(value.items.find((item) => item.orderId === orderId)),
          ),
        ]);
      })
      .catch(() => active && setError("UNAVAILABLE"));
    return () => {
      active = false;
    };
  }, [orderId]);

  async function continuePayment() {
    setPaying(true);
    setPaymentError(false);
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/payment-attempts`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: "{}",
        },
      );
      const parsed = directPaymentAttemptContract.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("payment unavailable");
      if (parsed.data.redirectUrl) window.location.assign(parsed.data.redirectUrl);
      else
        window.location.assign(
          `/orders/${orderId}/payment-result?${new URLSearchParams({ attemptId: parsed.data.attemptId })}`,
        );
    } catch {
      setPaymentError(true);
      setPaying(false);
    }
  }

  if (error) {
    const message =
      error === "SIGNED_OUT"
        ? "برای دیدن این سفارش دوباره وارد هویت سوو شوید."
        : error === "NOT_FOUND"
          ? "این سفارش پیدا نشد یا به هویت سوو شما تعلق ندارد."
          : "جزئیات سفارش در دسترس نیست. کمی بعد دوباره تلاش کنید.";
    return (
      <section
        className={styles.message}
        role={error === "UNAVAILABLE" ? "alert" : "status"}
      >
        <h1>پیگیری سفارش</h1>
        <p>{message}</p>
        <Link
          href={
            error === "SIGNED_OUT"
              ? `/login?returnTo=${encodeURIComponent(`/orders/${orderId}`)}&cancelTo=%2Forders`
              : "/orders"
          }
        >
          {error === "SIGNED_OUT" ? "ورود و ادامه" : "بازگشت به سفارش‌ها"}
        </Link>
      </section>
    );
  }
  if (!order)
    return (
      <p className={styles.message} role="status">
        در حال دریافت سفارش…
      </p>
    );

  const state = presentBuyerOrderState(order.status, refund?.status);
  return (
    <article className={styles.page}>
      <Link className={styles.back} href="/orders">
        همه سفارش‌ها
      </Link>
      <header className={styles.hero}>
        <p>{order.store.name}</p>
        <h1>{state.label}</h1>
        <p>{state.nextStep}</p>
        {order.status === "PENDING_PAYMENT" ? (
          <>
            <button
              className={styles.primary}
              disabled={paying}
              onClick={continuePayment}
            >
              {paying
                ? "در حال شروع پرداخت…"
                : `ادامه پرداخت ${formatIrrAsToman(order.total.amount)}`}
            </button>
            {paymentError ? (
              <p role="alert">شروع پرداخت ممکن نشد. وضعیت سفارش را تازه کنید.</p>
            ) : null}
          </>
        ) : null}
      </header>

      <section aria-labelledby="snapshot-title">
        <h2 id="snapshot-title">خلاصه ثبت‌شده سفارش</h2>
        <ul className={styles.items}>
          {order.items.map((item) => (
            <li key={item.variantId}>
              <span>
                {item.name} × {new Intl.NumberFormat("fa-IR").format(item.quantity)}
              </span>
              <strong>{formatIrrAsToman(item.lineTotal.amount)}</strong>
            </li>
          ))}
        </ul>
        <dl className={styles.facts}>
          <div>
            <dt>مبلغ نهایی</dt>
            <dd>{formatIrrAsToman(order.total.amount)}</dd>
          </div>
          <div>
            <dt>روش پرداخت</dt>
            <dd>تسویه مستقیم با فروشگاه</dd>
          </div>
          <div>
            <dt>روش ارسال</dt>
            <dd>{order.shippingMethod.label}</dd>
          </div>
          <div>
            <dt>زمان ثبت</dt>
            <dd>{formatDate(order.createdAt)}</dd>
          </div>
        </dl>
        <div className={styles.trust}>
          <h3>سیاست مرجوعی ثبت‌شده هنگام سفارش</h3>
          <p>{order.returnPolicy.text}</p>
          <p>سوو گزارش مشکل و تخلف را پیگیری می‌کند، اما بازپرداخت را تضمین نمی‌کند.</p>
        </div>
      </section>

      <section aria-labelledby="tracking-title">
        <h2 id="tracking-title">رهگیری و خط زمانی</h2>
        {fulfillment ? (
          <ol className={styles.timeline}>
            {fulfillment.timeline.map((entry, index) => (
              <li key={`${entry.status}-${entry.occurredAt}-${index}`}>
                <strong>{fulfillmentLabel(entry.status)}</strong>
                <time dateTime={entry.occurredAt}>{formatDate(entry.occurredAt)}</time>
                {entry.shipping?.trackingCode ? (
                  <span>
                    کد رهگیری: <bdi>{entry.shipping.trackingCode}</bdi>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p>پس از تأیید پرداخت، آماده‌سازی و ارسال در این بخش ثبت می‌شود.</p>
        )}
      </section>

      <section aria-labelledby="problem-title">
        <h2 id="problem-title">اختلاف و بازپرداخت</h2>
        {dispute ? (
          <p>
            پرونده اختلاف با وضعیت «{disputeStatusLabel(dispute.status)}» در{" "}
            {formatDate(dispute.openedAt)} ثبت شده است.
          </p>
        ) : (
          <p>برای این سفارش پرونده اختلافی ثبت نشده است.</p>
        )}
        {refund ? (
          <dl className={styles.facts}>
            <div>
              <dt>وضعیت بازپرداخت</dt>
              <dd>{refundStatusLabel(refund.status)}</dd>
            </div>
            <div>
              <dt>مبلغ</dt>
              <dd>{formatIrrAsToman(refund.amount.amount)}</dd>
            </div>
            <div>
              <dt>آخرین پیگیری</dt>
              <dd>{formatDate(refund.updatedAt)}</dd>
            </div>
          </dl>
        ) : (
          <p>بازپرداختی برای این سفارش ثبت نشده است.</p>
        )}
      </section>
    </article>
  );
}

async function optionalRead<Output>(
  path: string,
  contract: {
    safeParse(value: unknown): { success: true; data: Output } | { success: false };
  },
) {
  const response = await fetch(path, { cache: "no-store" });
  if (response.status === 404) return undefined;
  const parsed = contract.safeParse(await response.json());
  return response.ok && parsed.success ? parsed.data : undefined;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function fulfillmentLabel(status: FulfillmentTimeline["status"]) {
  return (
    {
      ACTION_REQUIRED: "در انتظار اقدام فروشگاه",
      PREPARING: "در حال آماده‌سازی",
      SHIPPED: "ارسال شد",
      DELIVERED: "تحویل شد",
      CANCELLATION_PENDING_REFUND: "لغو در انتظار بازپرداخت",
      CANCELLED: "لغو شد",
    } as const
  )[status];
}
function refundStatusLabel(status: DirectRefund["status"]) {
  return (
    {
      PENDING: "در حال تأیید درگاه",
      FAILED: "ناموفق؛ نیازمند تلاش دوباره فروشگاه",
      CONFIRMED: "تأییدشده",
    } as const
  )[status];
}
function disputeStatusLabel(status: BuyerDispute["status"]) {
  return (
    {
      DRAFT: "ثبت اولیه",
      SUBMITTED: "ثبت‌شده",
      AWAITING_SELLER_RESPONSE: "در انتظار پاسخ فروشگاه",
      UNDER_REVIEW: "در حال بررسی",
      RESOLVED: "نتیجه ثبت شده",
      CLOSED: "بسته شده",
    } as const
  )[status];
}
