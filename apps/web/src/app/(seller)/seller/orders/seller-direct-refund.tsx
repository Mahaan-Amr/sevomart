"use client";

import { directRefundContract, type DirectRefund } from "@sevo/contracts/payments/v1";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatIrrAsToman } from "../../../../lib/format-money";
import styles from "./seller-direct-refund.module.css";

export function SellerDirectRefund({ orderId }: { orderId: string }) {
  const [refund, setRefund] = useState<DirectRefund>();
  const [ready, setReady] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const loadRefund = useCallback(async () => {
    await fetch(`/api/seller/orders/${encodeURIComponent(orderId)}/direct-refund`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign("/seller/login");
          return;
        }
        if (response.status === 404) {
          setReady(true);
          return;
        }
        const parsed = directRefundContract.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error();
        setRefund(parsed.data);
        setError(undefined);
        setReady(true);
      })
      .catch(() => {
        setError("وضعیت بازپرداخت دریافت نشد. دوباره تلاش کنید.");
        setReady(true);
      });
  }, [orderId]);

  useEffect(() => {
    void loadRefund();
  }, [loadRefund]);

  useEffect(() => {
    if (refund?.status !== "PENDING") return;
    const poll = window.setInterval(() => void loadRefund(), 5_000);
    return () => window.clearInterval(poll);
  }, [loadRefund, refund?.status]);

  useEffect(() => {
    if (refund) resultRef.current?.focus();
  }, [refund?.status]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 8) {
      setError("دلیل لغو را کمی روشن‌تر بنویسید.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/seller/orders/${encodeURIComponent(orderId)}/direct-refund`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      const body: unknown = await response.json();
      const parsed = directRefundContract.safeParse(body);
      if (!response.ok || !parsed.success) {
        const message =
          typeof body === "object" && body && "message" in body
            ? String(body.message)
            : "درخواست لغو ثبت نشد. دوباره تلاش کنید.";
        throw new Error(message);
      }
      setRefund(parsed.data);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "درخواست لغو ثبت نشد. دوباره تلاش کنید.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="refund-title">
        <Link className={styles.back} href="/seller/orders">
          بازگشت به سفارش‌ها
        </Link>
        <p className={styles.eyebrow}>سفارش {orderId}</p>
        <h1 id="refund-title">لغو و پیگیری بازپرداخت</h1>
        <p className={styles.trust}>
          مبلغ مستقیم برای فروشگاه تسویه شده است. سوو درخواست و نتیجه معتبر درگاه یا
          تأیید خریدار را ثبت و پیگیری می‌کند، اما بازپرداخت را تضمین نمی‌کند.
        </p>

        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        {!ready ? <p role="status">در حال دریافت وضعیت…</p> : null}

        {ready && !refund ? (
          <form className={styles.form} onSubmit={submit}>
            <label htmlFor="refund-reason">دلیل لغو پیش از ارسال</label>
            <textarea
              id="refund-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={8}
              maxLength={500}
              rows={5}
              required
              aria-describedby="refund-help"
            />
            <small id="refund-help">
              سفارش تا تأیید نتیجه بازپرداخت لغوشده محسوب نمی‌شود و موجودی آزاد نخواهد
              شد.
            </small>
            <button disabled={pending} type="submit">
              {pending ? "در حال ثبت…" : "ثبت درخواست لغو و بررسی بازپرداخت"}
            </button>
          </form>
        ) : null}

        {refund ? (
          <div className={styles.result} role="status">
            <h2 ref={resultRef} tabIndex={-1}>
              {statusTitle(refund.status)}
            </h2>
            <dl>
              <div>
                <dt>مبلغ</dt>
                <dd>{formatIrrAsToman(refund.amount.amount)}</dd>
              </div>
              <div>
                <dt>وضعیت سفارش</dt>
                <dd>{orderStatus(refund.orderStatus)}</dd>
              </div>
            </dl>
            <p>{nextStep(refund.status)}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function statusTitle(status: DirectRefund["status"]) {
  if (status === "CONFIRMED") return "بازپرداخت تأیید و سفارش لغو شد";
  if (status === "FAILED") return "بازپرداخت ناموفق بود";
  return "لغو در انتظار تأیید بازپرداخت است";
}

function orderStatus(status: DirectRefund["orderStatus"]) {
  return status === "CANCELLED" ? "لغوشده" : "لغو در انتظار بازپرداخت";
}

function nextStep(status: DirectRefund["status"]) {
  if (status === "CONFIRMED") return "موجودی این سفارش دقیقاً یک‌بار آزاد شده است.";
  if (status === "FAILED") {
    return "بازپرداخت را از مسیر پرداخت دوباره انجام دهید؛ سوو فقط نتیجه معتبر تازه را ثبت می‌کند.";
  }
  return "تا رسیدن نتیجه معتبر منتظر بمانید؛ وضعیت این صفحه خودکار به‌روزرسانی می‌شود.";
}
