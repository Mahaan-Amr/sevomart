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

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="receipt-title">
        <h1 id="receipt-title">
          {attempt?.status === "CONFIRMED" ? "پرداخت تأیید شد" : "بررسی پرداخت"}
        </h1>
        {attempt?.status === "CONFIRMED" ? (
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
                <dt>شناسه سفارش</dt>
                <dd>{orderId}</dd>
              </div>
            </dl>
            <p className={styles.next}>قدم بعدی: فروشگاه سفارش را آماده می‌کند.</p>
          </>
        ) : failed ? (
          <p role="alert">رسید در دسترس نیست. از پیگیری سفارش دوباره تلاش کنید.</p>
        ) : (
          <p>نتیجه پرداخت در حال دریافت است…</p>
        )}
      </section>
    </main>
  );
}
