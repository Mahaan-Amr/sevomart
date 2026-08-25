"use client";

import { directPaymentAttemptContract } from "@sevo/contracts/payments/v1";
import { useCallback, useEffect, useState } from "react";

import { formatIrrAsToman } from "../../../../lib/format-money";
import styles from "./platform-payment-reviews.module.css";

type ReviewItem = {
  attempt: ReturnType<typeof directPaymentAttemptContract.parse>;
  orderStatus: "PAYMENT_REVIEW";
  audits: Array<{
    fromStatus: string | null;
    toStatus: string;
    reasonCode: string;
    correlationId: string;
    occurredAt: string;
  }>;
};

export function PlatformPaymentReviews() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/platform/payment-reviews", {
        cache: "no-store",
      });
      const body = (await response.json()) as { items?: unknown };
      if (!response.ok || !Array.isArray(body.items)) {
        throw new Error("صف بررسی پرداخت در دسترس نیست.");
      }
      const parsed = body.items.map((item) => parseReviewItem(item));
      setItems(parsed);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "خطایی رخ داد.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="payment-review-title">
        <header>
          <div>
            <p className={styles.eyebrow}>فضای کار عامل پلتفرم</p>
            <h1 id="payment-review-title">پرداخت‌های نیازمند بررسی</h1>
            <p>
              نتیجه مالی فقط از تطبیق درگاه می‌آید؛ این صفحه امکان تغییر دستی ندارد.
            </p>
          </div>
          <button type="button" onClick={refresh} disabled={loading}>
            {loading ? "در حال تازه‌سازی…" : "تازه‌کردن"}
          </button>
        </header>

        {message ? <p role="alert">{message}</p> : null}
        {!loading && items.length === 0 ? (
          <p className={styles.empty}>پرداختی در انتظار بررسی نیست.</p>
        ) : null}
        <ul className={styles.queue}>
          {items.map((item) => (
            <li key={item.attempt.attemptId}>
              <div className={styles.summary}>
                <div>
                  <strong>نتیجه پرداخت در حال بررسی است</strong>
                  <span>سفارش {item.attempt.orderId}</span>
                </div>
                <span>{formatIrrAsToman(item.attempt.amount.amount)}</span>
              </div>
              <dl>
                {item.audits.map((audit, index) => (
                  <div key={`${audit.occurredAt}-${index}`}>
                    <dt>{reasonLabel(audit.reasonCode)}</dt>
                    <dd>
                      {new Intl.DateTimeFormat("fa-IR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(audit.occurredAt))}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function parseReviewItem(value: unknown): ReviewItem {
  if (!value || typeof value !== "object") throw new Error("داده صف معتبر نیست.");
  const item = value as Partial<ReviewItem>;
  if (item.orderStatus !== "PAYMENT_REVIEW" || !Array.isArray(item.audits)) {
    throw new Error("داده صف معتبر نیست.");
  }
  return {
    attempt: directPaymentAttemptContract.parse(item.attempt),
    orderStatus: item.orderStatus,
    audits: item.audits,
  };
}

function reasonLabel(reasonCode: string) {
  const labels: Record<string, string> = {
    PAYMENT_ATTEMPT_CREATED: "تلاش پرداخت ساخته شد",
    PROVIDER_DISPATCH_CLAIMED: "ارسال به درگاه ثبت شد",
    PROVIDER_RESULT_PENDING: "درگاه نتیجه قطعی نداد",
    DISPATCH_LEASE_EXPIRED: "نتیجه ارسال در مهلت نرسید",
    PROVIDER_INITIATION_OUTCOME_UNKNOWN: "نتیجه شروع پرداخت نامشخص ماند",
    PROVIDER_AMOUNT_MISMATCH: "مبلغ callback با سفارش سازگار نبود",
    PAID_STOCK_CONFLICT: "پرداخت ثبت شد؛ موجودی نیازمند بررسی است",
  };
  return labels[reasonCode] ?? reasonCode;
}
