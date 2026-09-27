"use client";

import {
  devPurchaseGroupPaymentResultContract,
  purchaseGroupContract,
  type PurchaseGroupV2,
} from "@sevo/contracts/orders/v2";
import { useEffect, useState } from "react";

import { formatIrrAsToman } from "../../../../lib/format-money";
import styles from "../../checkout/checkout.module.css";

export function PurchaseReceipt({
  groupId,
  developmentPayment,
}: {
  groupId: string;
  developmentPayment: boolean;
}) {
  const [purchase, setPurchase] = useState<PurchaseGroupV2>();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void load();
  }, [groupId]);

  async function load() {
    try {
      const response = await fetch(
        `/api/purchase-groups/${encodeURIComponent(groupId)}`,
        { cache: "no-store" },
      );
      const parsed = purchaseGroupContract.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("unavailable");
      setPurchase(parsed.data);
    } catch {
      setMessage("رسید این خرید بارگیری نشد. دوباره تلاش کنید.");
    }
  }

  async function pay() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/purchase-groups/${encodeURIComponent(groupId)}/dev-payment`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ scenario: "success" }),
        },
      );
      const body = await response.json();
      const parsed = devPurchaseGroupPaymentResultContract.safeParse(body);
      if (!response.ok || !parsed.success) {
        setMessage(
          body.message ?? "پرداخت آزمایشی انجام نشد. وضعیت خرید را دوباره بررسی کنید.",
        );
        await load();
        return;
      }
      setPurchase(parsed.data.purchase);
      if (parsed.data.paymentStatus === "FAILED")
        setMessage("پرداخت انجام نشد. می‌توانید دوباره تلاش کنید.");
      if (parsed.data.paymentStatus === "REVIEW_REQUIRED")
        setMessage("نتیجهٔ پرداخت در حال بررسی است. دوباره پرداخت نکنید.");
    } catch {
      setMessage(
        "نتیجهٔ پرداخت روشن نیست. وضعیت خرید را دوباره بررسی کنید و پرداخت را تکرار نکنید.",
      );
      await load();
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="purchase-title">
        <a className={styles.back} href="/orders">
          خریدهای من
        </a>
        <h1 id="purchase-title">خرید شما</h1>
        {!purchase ? (
          <p role="status">در حال آماده‌کردن رسید…</p>
        ) : (
          <>
            <p className={styles.note}>
              {purchase.status === "PAID"
                ? "پرداخت این خرید ثبت شد. هر فروشگاه سفارش خود را جدا پیگیری می‌کند."
                : purchase.status === "PAYMENT_REVIEW"
                  ? "پرداخت در حال بررسی است. برای جلوگیری از پرداخت دوباره، اکنون اقدامی لازم نیست."
                  : purchase.status === "EXPIRED"
                    ? "مهلت پرداخت این خرید گذشته است."
                    : "سفارش‌ها ثبت شدند و منتظر پرداخت یک‌جا هستند. هیچ سفارش پرداخت‌نشده‌ای به فروشگاه تحویل نمی‌شود."}
            </p>
            {purchase.stores.map((store) => (
              <section
                className={styles.storeGroup}
                key={store.orderId}
                aria-label={`سفارش ${store.name}`}
              >
                <h2>{store.name}</h2>
                <p>
                  مبلغ با ارسال: <strong>{formatIrrAsToman(store.total.amount)}</strong>
                </p>
                <p>ارسال: {store.shippingLabel}</p>
                <p>مرجوعی: {store.returnPolicyText}</p>
                <a href={`/orders/${encodeURIComponent(store.orderId)}`}>
                  پیگیری سفارش این فروشگاه
                </a>
              </section>
            ))}
            <div className={styles.total}>
              <span>مبلغ یک پرداخت</span>
              <strong>{formatIrrAsToman(purchase.total.amount)}</strong>
            </div>
            {purchase.status === "PENDING_PAYMENT" && developmentPayment ? (
              <>
                <p className={styles.devNotice}>
                  پرداخت آزمایشی محیط توسعه است و پول واقعی جابه‌جا نمی‌شود.
                </p>
                <button
                  className={styles.primary}
                  type="button"
                  disabled={pending}
                  onClick={pay}
                >
                  {pending
                    ? "در حال ثبت نتیجه…"
                    : `پرداخت آزمایشی ${formatIrrAsToman(purchase.total.amount)}`}
                </button>
              </>
            ) : null}
            {purchase.status === "PENDING_PAYMENT" && !developmentPayment ? (
              <p className={styles.devNotice}>
                پرداخت یک‌جای واقعی پس از آماده‌شدن ارائه‌دهنده فعال می‌شود.
              </p>
            ) : null}
          </>
        )}
        {message ? (
          <p className={styles.error} role="alert">
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
