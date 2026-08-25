"use client";

import {
  paymentReviewQueueContract,
  type PaymentReviewItem,
} from "@sevo/contracts/payments/v1";
import { useCallback, useEffect, useState } from "react";

import { formatIrrAsToman } from "../../../../lib/format-money";
import styles from "./platform-payment-reviews.module.css";

export function PlatformPaymentReviews() {
  const [items, setItems] = useState<readonly PaymentReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/platform/payment-reviews", {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      const parsed = paymentReviewQueueContract.safeParse(body);
      if (!response.ok || !parsed.success) {
        throw new Error("صف بررسی پرداخت در دسترس نیست.");
      }
      setItems(parsed.data.items);
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
                  <strong>
                    {item.reviewKind === "PAID_STOCK_CONFLICT"
                      ? "پرداخت ثبت شده و موجودی در حال بررسی است"
                      : "نتیجه پرداخت در حال بررسی است"}
                  </strong>
                  <span>سفارش {item.attempt.orderId}</span>
                </div>
                <span>{formatIrrAsToman(item.attempt.amount.amount)}</span>
              </div>
              {item.alertKinds.length > 0 ? (
                <p role="status">این مورد نیازمند پیگیری عملیاتی است.</p>
              ) : null}
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

function reasonLabel(reasonCode: PaymentReviewItem["audits"][number]["reasonCode"]) {
  const labels: Record<PaymentReviewItem["audits"][number]["reasonCode"], string> = {
    PAYMENT_ATTEMPT_CREATED: "تلاش پرداخت ساخته شد",
    PROVIDER_DISPATCH_CLAIMED: "ارسال به درگاه ثبت شد",
    PROVIDER_RESULT_PENDING: "درگاه نتیجه قطعی نداد",
    DISPATCH_LEASE_EXPIRED: "نتیجه ارسال در مهلت نرسید",
    PROVIDER_INITIATION_OUTCOME_UNKNOWN: "نتیجه شروع پرداخت نامشخص ماند",
    PROVIDER_AMOUNT_MISMATCH: "مبلغ نتیجه درگاه با سفارش سازگار نبود",
    PAID_STOCK_CONFLICT: "پرداخت ثبت شد؛ موجودی نیازمند بررسی است",
    DISPATCH_NOT_STARTED_BEFORE_LEASE_EXPIRY: "ارسال به درگاه آغاز نشد",
    PROVIDER_FAILED: "درگاه پرداخت را ناموفق اعلام کرد",
    PROVIDER_CONFIRMED: "درگاه پرداخت را تأیید کرد",
    DUPLICATE_PROVIDER_EVENT_AMOUNT_MISMATCH: "مبلغ نتیجه تکراری با سفارش سازگار نبود",
    PROVIDER_RESULT_CONTRADICTS_CONFIRMED: "نتیجه تازه با تأیید قطعی پیشین سازگار نبود",
    PROVIDER_RESULT_CONTRADICTS_FAILED: "نتیجه تازه با شکست قطعی پیشین سازگار نبود",
  };
  return labels[reasonCode];
}
