"use client";

import {
  paymentReviewQueueV2Contract,
  type PaymentReviewItemV2,
} from "@sevo/contracts/payments/v2";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { formatIrrAsToman } from "../../../../lib/format-money";
import styles from "./platform-payment-reviews.module.css";

export function PlatformPaymentReviews() {
  const [items, setItems] = useState<readonly PaymentReviewItemV2[]>([]);
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
      const parsed = paymentReviewQueueV2Contract.safeParse(body);
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
            <li key={item.reviewId}>
              <div className={styles.summary}>
                <div>
                  <strong>
                    {item.reviewKind === "PAID_STOCK_CONFLICT"
                      ? "پرداخت ثبت شده و موجودی در حال بررسی است"
                      : item.reviewKind === "PROVIDER_CONFLICT"
                        ? "نتیجه درگاه با سابقه پرداخت سازگار نیست"
                        : "نتیجه پرداخت در حال بررسی است"}
                  </strong>
                  <span>
                    {item.provider} · ثبت در {formatDate(item.openedAt)}
                  </span>
                </div>
                <span>{formatIrrAsToman(item.amount.amount)}</span>
              </div>
              {item.needsFollowUp ? (
                <p role="status">این مورد نیازمند پیگیری عملیاتی است.</p>
              ) : null}
              <Link href={`/platform/payment-reviews/${item.reviewId}`}>
                بازکردن پرونده
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
