"use client";

import {
  paymentReconciliationRequestContract,
  paymentReviewDetailContract,
  type PaymentReviewDetail as PaymentReviewDetailView,
} from "@sevo/contracts/payments/v1";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { formatIrrAsToman } from "../../../../../lib/format-money";
import styles from "./payment-review-detail.module.css";

export function PaymentReviewDetail({ reviewId }: { reviewId: string }) {
  const [grantId, setGrantId] = useState("");
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState<PaymentReviewDetailView>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function reveal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/platform/payment-reviews/${reviewId}/reveal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grantId, reason }),
      });
      const body: unknown = await response.json();
      const parsed = paymentReviewDetailContract.safeParse(body);
      if (!response.ok || !parsed.success) throw new Error(readMessage(body));
      setDetail(parsed.data);
      setMessage("مدرک همین پرونده آشکار شد و مشاهده در سابقه دسترسی ثبت شد.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "جزئیات در دسترس نیست.");
    } finally {
      setPending(false);
    }
  }

  async function reconcile() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/platform/payment-reviews/${reviewId}/reconciliation`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      const body: unknown = await response.json();
      if (
        !response.ok ||
        !paymentReconciliationRequestContract.safeParse(body).success
      ) {
        throw new Error(readMessage(body));
      }
      setMessage(
        "تطبیق دوباره از درگاه درخواست شد؛ نتیجه فقط پس از پاسخ معتبر درگاه تغییر می‌کند.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "درخواست ثبت نشد.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="review-detail-title">
        <Link className={styles.back} href="/platform/payment-reviews">
          بازگشت به صف
        </Link>
        <p className={styles.eyebrow}>پرونده بررسی پرداخت</p>
        <h1 id="review-detail-title">مدرک و تاریخچه تطبیق</h1>
        <p>
          نتیجه مالی فقط از مدرک معتبر درگاه می‌آید. این صفحه امکان موفق یا ناموفق کردن
          دستی پرداخت را ندارد.
        </p>

        {!detail ? (
          <form className={styles.reveal} onSubmit={(event) => void reveal(event)}>
            <h2>آشکارکردن کمینه اطلاعات پرونده</h2>
            <p>
              اجازه باید برای همین پرونده، اقدام «آشکارسازی کمینه» و مهلت فعال صادر شده
              باشد. <Link href="/platform/access">مدیریت دسترسی‌ها</Link>
            </p>
            <label>
              شناسه اجازه دسترسی حساس
              <input
                dir="ltr"
                value={grantId}
                onChange={(event) => setGrantId(event.target.value)}
                required
                autoComplete="off"
              />
            </label>
            <label>
              دلیل مشاهده این پرونده
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={8}
                maxLength={500}
                required
              />
            </label>
            <button type="submit" disabled={pending}>
              {pending ? "در حال بررسی اجازه…" : "آشکارکردن اطلاعات پرونده"}
            </button>
          </form>
        ) : (
          <>
            <aside className={styles.expiry} role="status">
              این مشاهده تا {formatDate(detail.accessExpiresAt!)} مجاز است؛ هر مشاهده
              دوباره ممیزی می‌شود.
            </aside>
            <dl className={styles.facts}>
              <Fact label="وضعیت" value={statusLabel(detail.status)} />
              <Fact label="مبلغ" value={formatIrrAsToman(detail.amount.amount)} />
              <Fact label="درگاه" value={detail.provider} />
              <Fact
                label="شناسه درگاه"
                value={detail.providerReference ?? "ثبت نشده"}
              />
              <Fact label="سفارش" value={detail.orderId} ltr />
              <Fact
                label="تعداد تطبیق"
                value={new Intl.NumberFormat("fa-IR").format(
                  detail.reconciliationCount,
                )}
              />
            </dl>

            <section className={styles.history} aria-labelledby="evidence-title">
              <h2 id="evidence-title">مدرک‌های درگاه</h2>
              {detail.observations.length === 0 ? (
                <p>هنوز مدرک نتیجه‌ای از درگاه ثبت نشده است.</p>
              ) : (
                <ol>
                  {detail.observations.map((observation) => (
                    <li key={observation.providerEventId}>
                      <strong>{resultLabel(observation.result)}</strong>
                      <span>{formatDate(observation.observedAt)}</span>
                      <small dir="ltr">{observation.providerEventId}</small>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className={styles.history} aria-labelledby="audit-title">
              <h2 id="audit-title">تاریخچه تطبیق</h2>
              <ol>
                {detail.audits.map((audit, index) => (
                  <li key={`${audit.occurredAt}-${index}`}>
                    <strong>{reasonLabel(audit.reasonCode)}</strong>
                    <span>{formatDate(audit.occurredAt)}</span>
                  </li>
                ))}
              </ol>
            </section>

            {detail.status === "REVIEW_REQUIRED" ? (
              <button
                className={styles.reconcile}
                type="button"
                disabled={pending || reason.trim().length < 8}
                onClick={() => void reconcile()}
              >
                {pending ? "در حال ثبت…" : "درخواست تطبیق دوباره از درگاه"}
              </button>
            ) : null}
          </>
        )}
        {message ? <p role="status">{message}</p> : null}
      </section>
    </main>
  );
}

function Fact({
  label,
  value,
  ltr = false,
}: {
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd dir={ltr ? "ltr" : undefined}>{value}</dd>
    </div>
  );
}

function readMessage(body: unknown) {
  return typeof body === "object" && body !== null && "message" in body
    ? String(body.message)
    : "درخواست انجام نشد؛ دوباره تلاش کنید.";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(status: PaymentReviewDetailView["status"]) {
  return status === "REVIEW_REQUIRED"
    ? "نیازمند تطبیق"
    : status === "CONFIRMED"
      ? "تأییدشده توسط درگاه"
      : status === "FAILED"
        ? "ناموفق طبق درگاه"
        : "در جریان";
}

function resultLabel(
  result: PaymentReviewDetailView["observations"][number]["result"],
) {
  return result === "CONFIRMED"
    ? "تأییدشده"
    : result === "FAILED"
      ? "ناموفق"
      : "بدون نتیجه قطعی";
}

function reasonLabel(reason: PaymentReviewDetailView["audits"][number]["reasonCode"]) {
  const labels: Record<typeof reason, string> = {
    PAYMENT_ATTEMPT_CREATED: "تلاش پرداخت ساخته شد",
    PROVIDER_DISPATCH_CLAIMED: "ارسال به درگاه ثبت شد",
    PROVIDER_RESULT_PENDING: "درگاه نتیجه قطعی نداد",
    DISPATCH_LEASE_EXPIRED: "نتیجه ارسال در مهلت نرسید",
    PROVIDER_INITIATION_OUTCOME_UNKNOWN: "نتیجه شروع پرداخت نامشخص ماند",
    PROVIDER_AMOUNT_MISMATCH: "مبلغ نتیجه درگاه سازگار نبود",
    PAID_STOCK_CONFLICT: "پرداخت ثبت شد؛ موجودی نیازمند بررسی است",
    DISPATCH_NOT_STARTED_BEFORE_LEASE_EXPIRY: "ارسال به درگاه آغاز نشد",
    PROVIDER_FAILED: "درگاه پرداخت را ناموفق اعلام کرد",
    PROVIDER_CONFIRMED: "درگاه پرداخت را تأیید کرد",
    DUPLICATE_PROVIDER_EVENT_AMOUNT_MISMATCH: "مبلغ رویداد تکراری سازگار نبود",
    DUPLICATE_PROVIDER_EVENT_RESULT_CONFLICT: "رویداد تکراری نتیجه دیگری داشت",
    PROVIDER_RESULT_CONTRADICTS_CONFIRMED: "نتیجه تازه با تأیید قطعی ناسازگار بود",
    PROVIDER_RESULT_CONTRADICTS_FAILED: "نتیجه تازه با شکست قطعی ناسازگار بود",
    PROVIDER_REFERENCE_RECOVERED: "شناسه درگاه برای تطبیق بازیابی شد",
  };
  return labels[reason];
}
