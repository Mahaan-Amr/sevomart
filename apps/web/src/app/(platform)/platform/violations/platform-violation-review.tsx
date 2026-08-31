"use client";

import { platformAccessGrantIdContract } from "@sevo/contracts/identity-access/v1";
import {
  platformViolationCaseViewContract,
  platformViolationQueueItemContract,
  platformViolationQueueContract,
} from "@sevo/contracts/problem-follow-up/v1";
import { useCallback, useEffect, useState } from "react";

import styles from "./platform-violation-review.module.css";

type PlatformViolationCaseView = ReturnType<
  typeof platformViolationCaseViewContract.parse
>;
type PlatformViolationQueueItem = ReturnType<
  typeof platformViolationQueueItemContract.parse
>;

export function PlatformViolationReview() {
  const [items, setItems] = useState<readonly PlatformViolationQueueItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlatformViolationCaseView | null>(null);
  const [grantId, setGrantId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [revealing, setRevealing] = useState(false);
  const [message, setMessage] = useState("");

  const loadQueue = useCallback(async (cursor?: string) => {
    setLoading(true);
    setMessage("");
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const response = await fetch(`/api/platform/violations${query}`, {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      const parsed = platformViolationQueueContract.safeParse(body);
      if (!response.ok || !parsed.success) {
        throw new Error("صف پرونده‌های تخلف در دسترس نیست.");
      }
      setItems((current) =>
        cursor ? [...current, ...parsed.data.items] : parsed.data.items,
      );
      setNextCursor(parsed.data.nextCursor);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "خطایی رخ داد.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void loadQueue(), [loadQueue]);

  function selectCase(violationCaseId: string) {
    setSelectedId(violationCaseId);
    setDetail(null);
    setGrantId("");
    setReason("");
    setMessage("");
  }

  async function reveal() {
    if (!selectedId) return;
    if (!platformAccessGrantIdContract.safeParse(grantId).success) {
      setMessage("شناسه اجازه دسترسی معتبر را وارد کنید.");
      return;
    }
    if (reason.trim().length < 10) {
      setMessage("دلیل روشن برای مشاهده را با دست‌کم ۱۰ نویسه بنویسید.");
      return;
    }
    setRevealing(true);
    setMessage("");
    try {
      const response = await fetch(`/api/platform/violations/${selectedId}`, {
        cache: "no-store",
        headers: {
          "x-platform-access-grant-id": grantId,
          "x-platform-access-reason": encodeURIComponent(reason.trim()),
        },
      });
      const body: unknown = await response.json();
      const parsed = platformViolationCaseViewContract.safeParse(body);
      if (!response.ok || !parsed.success) {
        throw new Error(
          response.status === 403
            ? "اجازه دسترسی این پرونده فعال نیست یا پایان یافته است."
            : "جزئیات پرونده دریافت نشد.",
        );
      }
      setDetail(parsed.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "خطایی رخ داد.");
    } finally {
      setRevealing(false);
    }
  }

  const selected = items.find((item) => item.violationCaseId === selectedId);
  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="violation-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>فضای کار عامل پلتفرم</p>
            <h1 id="violation-title">پرونده‌های تخلف نیازمند بررسی</h1>
            <p>صف فقط اطلاعات کمینه را نشان می‌دهد؛ مشاهده مدرک ثبت و ممیزی می‌شود.</p>
          </div>
          <button type="button" onClick={() => loadQueue()} disabled={loading}>
            {loading ? "در حال تازه‌سازی…" : "تازه‌کردن"}
          </button>
        </header>

        {message ? (
          <p className={styles.message} role="alert" aria-live="polite">
            {message}
          </p>
        ) : null}

        <div className={styles.reviewArea} aria-busy={loading || revealing}>
          <div>
            <h2>صف بررسی</h2>
            {!loading && items.length === 0 ? (
              <p className={styles.empty}>پرونده‌ای برای بررسی باقی نمانده است.</p>
            ) : null}
            <ul className={styles.queue}>
              {items.map((item) => (
                <li key={item.violationCaseId}>
                  <button
                    type="button"
                    className={item.violationCaseId === selectedId ? styles.active : ""}
                    onClick={() => selectCase(item.violationCaseId)}
                    aria-pressed={item.violationCaseId === selectedId}
                  >
                    <strong>{typeLabel(item.type)}</strong>
                    <span>{statusLabel(item.status)}</span>
                    <small>
                      {sourceLabel(item.source.kind)} ·{" "}
                      {nextActionLabel(item.nextActionCode)}
                    </small>
                    <span>بررسی پرونده</span>
                  </button>
                </li>
              ))}
            </ul>
            {nextCursor ? (
              <button
                className={styles.more}
                type="button"
                onClick={() => loadQueue(nextCursor)}
                disabled={loading}
              >
                نمایش پرونده‌های بیشتر
              </button>
            ) : null}
          </div>

          <section className={styles.detail} aria-labelledby="case-detail-title">
            <h2 id="case-detail-title">جزئیات پرونده</h2>
            {!selected ? (
              <p className={styles.empty}>
                برای ادامه، یک پرونده را از صف انتخاب کنید.
              </p>
            ) : detail ? (
              <RevealedDetail detail={detail} />
            ) : (
              <div className={styles.revealPanel}>
                <p>جزئیات حساس هنوز آشکار نشده‌اند.</p>
                <p>
                  اجازه فعال باید دقیقاً برای همین پرونده و عمل «آشکارسازی حداقل» باشد.
                </p>
                <label>
                  <span>شناسه اجازه دسترسی فعال</span>
                  <input
                    value={grantId}
                    onChange={(event) => setGrantId(event.target.value)}
                    dir="ltr"
                    autoComplete="off"
                  />
                </label>
                <label>
                  <span>دلیل مشاهده</span>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    maxLength={1_000}
                  />
                </label>
                <button type="button" onClick={reveal} disabled={revealing}>
                  {revealing ? "در حال بررسی اجازه…" : "آشکارسازی حداقل لازم"}
                </button>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function RevealedDetail({ detail }: { detail: PlatformViolationCaseView }) {
  return (
    <div className={styles.revealed}>
      <p className={styles.receipt} role="status">
        مشاهده ثبت و ممیزی شد.
      </p>
      <dl>
        <div>
          <dt>نوع پرونده</dt>
          <dd>{typeLabel(detail.type)}</dd>
        </div>
        <div>
          <dt>وضعیت مستقل</dt>
          <dd>{statusLabel(detail.status)}</dd>
        </div>
        <div>
          <dt>اقدام بعدی</dt>
          <dd>{nextActionLabel(detail.nextActionCode)}</dd>
        </div>
        <div>
          <dt>اعتبار مشاهده تا</dt>
          <dd>{formatDate(detail.access.expiresAt)}</dd>
        </div>
      </dl>
      <h3>مدارک مرتبط</h3>
      {detail.evidence.length === 0 ? (
        <p>مدرکی برای این پرونده ثبت نشده است.</p>
      ) : (
        <ul className={styles.evidence}>
          {detail.evidence.map((evidence) => (
            <li key={evidence.evidenceId}>
              <strong>{evidenceLabel(evidence.kind)}</strong>
              <span>{formatDate(evidence.submittedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function typeLabel(type: PlatformViolationQueueItem["type"]) {
  return {
    FULFILLMENT_NONCOMPLIANCE: "عدم رعایت تعهد انجام سفارش",
    MISREPRESENTATION: "اطلاعات گمراه‌کننده",
    REFUND_NONCOMPLIANCE: "عدم رعایت تعهد بازپرداخت",
    REPEATED_DISPUTES: "اختلاف‌های تکرارشونده",
    PLATFORM_POLICY_BREACH: "نقض قواعد پلتفرم",
  }[type];
}

function statusLabel(status: PlatformViolationQueueItem["status"]) {
  return {
    OPEN: "باز",
    UNDER_REVIEW: "در حال بررسی",
    RESOLVED: "حل‌شده",
    CLOSED: "بسته‌شده",
  }[status];
}

function nextActionLabel(action: PlatformViolationQueueItem["nextActionCode"]) {
  return {
    START_REVIEW: "شروع بررسی",
    REVIEW_EVIDENCE: "مرور مدرک",
    RECORD_ACTION: "ثبت اقدام",
    NO_ACTION: "بدون اقدام بعدی",
  }[action];
}

function sourceLabel(source: PlatformViolationQueueItem["source"]["kind"]) {
  return {
    DISPUTE: "برآمده از پرونده اختلاف",
    ORDER: "برآمده از سفارش",
    OPERATIONAL_REPORT: "برآمده از گزارش عملیاتی",
  }[source];
}

function evidenceLabel(kind: PlatformViolationCaseView["evidence"][number]["kind"]) {
  return {
    IMAGE: "مدرک تصویری",
    DOCUMENT: "سند",
    MESSAGE_REFERENCE: "ارجاع گفت‌وگو",
  }[kind];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
