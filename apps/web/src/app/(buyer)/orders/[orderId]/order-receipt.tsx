"use client";

import {
  directPaymentAttemptContract,
  type DirectPaymentAttempt,
} from "@sevo/contracts/payments/v1";
import { useEffect, useState } from "react";

import { formatIrrAsToman } from "../../../../lib/format-money";
import styles from "./order-receipt.module.css";

export function OrderReceipt({
  orderId,
  attemptId,
}: {
  orderId: string;
  attemptId?: string;
}) {
  const [attempt, setAttempt] = useState<DirectPaymentAttempt>();
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!attemptId) {
      setFailed(true);
      return;
    }
    void fetch(`/api/payment-attempts/${attemptId}`, { cache: "no-store" })
      .then(async (response) => {
        const parsed = directPaymentAttemptContract.safeParse(await response.json());
        if (!response.ok || !parsed.success || parsed.data.orderId !== orderId) {
          throw new Error("receipt unavailable");
        }
        setAttempt(parsed.data);
      })
      .catch(() => setFailed(true));
  }, [attemptId, orderId]);

  async function retryPayment() {
    setRetrying(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/orders/${orderId}/payment-attempts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: "{}",
      });
      const parsed = directPaymentAttemptContract.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("retry unavailable");
      setAttempt(parsed.data);
      if (parsed.data.redirectUrl) window.location.assign(parsed.data.redirectUrl);
    } catch {
      setFailed(true);
    } finally {
      setRetrying(false);
    }
  }

  const title =
    attempt?.status === "CONFIRMED" && attempt.orderStatus === "PAYMENT_REVIEW"
      ? "پرداخت ثبت شد؛ سفارش در حال بررسی است"
      : attempt?.orderStatus === "PAYMENT_REVIEW"
        ? "نتیجه پرداخت در حال بررسی است"
        : attempt?.status === "CONFIRMED"
          ? "پرداخت تأیید شد"
          : attempt?.status === "FAILED" && attempt.orderStatus === "EXPIRED"
            ? "مهلت پرداخت تمام شد"
            : attempt?.status === "FAILED"
              ? "پرداخت انجام نشد"
              : attempt?.status === "REVIEW_REQUIRED"
                ? "نتیجه پرداخت در حال بررسی است"
                : "در انتظار نتیجه پرداخت";

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="receipt-title">
        <h1 id="receipt-title">{title}</h1>
        {attempt?.status === "CONFIRMED" && attempt.orderStatus === "PAYMENT_REVIEW" ? (
          <>
            <p>
              پرداخت ثبت شده است، اما موجودی لازم برای تحویل قطعی نبود. سوو سفارش را
              بررسی می‌کند.
            </p>
            <p className={styles.next}>
              تا پایان بررسی، انجام سفارش یا بازپرداخت قطعی وعده داده نمی‌شود.
            </p>
          </>
        ) : attempt?.orderStatus === "PAYMENT_REVIEW" ? (
          <>
            <p>
              نتیجه تازه درگاه با سابقه این تلاش سازگار نیست. برای جلوگیری از پرداخت
              دوباره، سفارش تا بررسی سوو متوقف شده است.
            </p>
            <p className={styles.next}>
              فروشگاه هنوز اقدام تازه‌ای برای این سفارش دریافت نمی‌کند.
            </p>
          </>
        ) : attempt?.status === "CONFIRMED" ? (
          <>
            <p>سفارش اکنون برای فروشگاه قابل اقدام است.</p>
            <dl>
              <div>
                <dt>مبلغ</dt>
                <dd>{formatIrrAsToman(attempt.amount.amount)}</dd>
              </div>
              <div>
                <dt>روش پرداخت</dt>
                <dd>تسویه مستقیم با فروشگاه</dd>
              </div>
              <div>
                <dt>زمان پرداخت</dt>
                <dd>
                  {new Intl.DateTimeFormat("fa-IR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(attempt.confirmedAt!))}
                </dd>
              </div>
              <div>
                <dt>شناسه سفارش</dt>
                <dd>{orderId}</dd>
              </div>
            </dl>
            <p className={styles.next}>قدم بعدی: فروشگاه سفارش را آماده می‌کند.</p>
          </>
        ) : attempt?.status === "FAILED" && attempt.orderStatus === "EXPIRED" ? (
          <>
            <p>رزرو کالا آزاد شد و این سفارش دیگر قابل پرداخت نیست.</p>
            <a href="/cart" className={styles.primary}>
              بازگشت به سبد
            </a>
          </>
        ) : attempt?.status === "FAILED" ? (
          <>
            <p>
              مبلغی برای این تلاش تأیید نشد. رزرو کالا فقط تا مهلت اصلی سفارش باقی
              می‌ماند.
            </p>
            {attempt.reservationExpiresAt ? (
              <p className={styles.next}>
                مهلت تلاش دوباره: {formatPaymentDeadline(attempt.reservationExpiresAt)}
              </p>
            ) : null}
            <button
              className={styles.primary}
              disabled={retrying}
              onClick={retryPayment}
            >
              {retrying ? "در حال شروع…" : "تلاش دوباره"}
            </button>
            {failed ? (
              <p role="alert">شروع دوباره پرداخت ممکن نشد. کمی بعد تلاش کنید.</p>
            ) : null}
          </>
        ) : attempt?.status === "REVIEW_REQUIRED" ? (
          <>
            <p>
              هنوز نتیجه قطعی از درگاه نرسیده است. برای جلوگیری از پرداخت دوباره، تلاش
              تازه تا پایان بررسی بسته است.
            </p>
            <p className={styles.next}>
              فروشگاه هنوز سفارشی برای آماده‌سازی دریافت نکرده است.
            </p>
          </>
        ) : failed ? (
          <p role="alert">رسید در دسترس نیست. از پیگیری سفارش دوباره تلاش کنید.</p>
        ) : (
          <p>نتیجه پرداخت در حال دریافت است؛ این صفحه را نبندید.</p>
        )}
      </section>
    </main>
  );
}

function formatPaymentDeadline(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
