"use client";

import { platformAccessGrantContract } from "@sevo/contracts/identity-access/v1";
import {
  platformDisputeQueueContract,
  platformDisputeViewContract,
} from "@sevo/contracts/problem-follow-up/v1";
import {
  resolveDisputeInputV2Contract,
  reopenDisputeInputV2Contract,
} from "@sevo/contracts/problem-follow-up/v2";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import styles from "./platform-disputes.module.css";

type Queue = ReturnType<typeof platformDisputeQueueContract.parse>;
type QueueItem = Queue["items"][number];
type DisputeView = ReturnType<typeof platformDisputeViewContract.parse>;
type EvidenceKind = "IMAGE" | "DOCUMENT" | "MESSAGE_REFERENCE";
type OutcomeCode =
  | "SELLER_ACTION_AGREED"
  | "PARTIES_REACHED_AGREEMENT"
  | "POLICY_EXPLAINED"
  | "VIOLATION_RECORDED"
  | "INSUFFICIENT_EVIDENCE"
  | "REFERRED_TO_FORMAL_CHANNEL";

const categoryLabels: Record<QueueItem["category"], string> = {
  DELIVERY_NOT_RECEIVED: "سفارش تحویل نشده",
  DAMAGED: "کالا آسیب‌دیده",
  NOT_AS_DESCRIBED: "کالا با توضیحات مغایرت دارد",
  WRONG_ITEM: "کالای دیگری تحویل شده",
  REFUND_NOT_COMPLETED: "بازپرداخت تکمیل نشده",
};

const statusLabels: Record<QueueItem["status"], string> = {
  DRAFT: "پیش‌نویس",
  SUBMITTED: "ثبت‌شده",
  AWAITING_SELLER_RESPONSE: "منتظر پاسخ فروشنده",
  UNDER_REVIEW: "نیازمند بررسی پلتفرم",
  RESOLVED: "حل‌شده",
  CLOSED: "بسته‌شده",
};

const outcomeLabels: Record<OutcomeCode, string> = {
  SELLER_ACTION_AGREED: "اقدام فروشنده ثبت شد",
  PARTIES_REACHED_AGREEMENT: "دو طرف به توافق رسیدند",
  POLICY_EXPLAINED: "قواعد و مسیر بعدی توضیح داده شد",
  VIOLATION_RECORDED: "تخلف برای پیگیری جدا ثبت شد",
  INSUFFICIENT_EVIDENCE: "مدرک کافی نبود",
  REFERRED_TO_FORMAL_CHANNEL: "به مسیر رسمی ارجاع شد",
};

export function PlatformDisputes() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<DisputeView>();
  const [grantId, setGrantId] = useState("");
  const [accessReason, setAccessReason] = useState("");
  const [message, setMessage] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  const selected = useMemo(
    () => queue.find((item) => item.disputeId === selectedId) ?? queue[0],
    [queue, selectedId],
  );

  const readQueue = useCallback(async (cursor?: string, clearMessage = true) => {
    setLoading(true);
    if (clearMessage) setMessage("");
    try {
      const response = await fetch(
        `/api/platform/disputes?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { cache: "no-store" },
      );
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(humanError(body));
      const page = platformDisputeQueueContract.parse(body);
      setQueue((current) => (cursor ? appendUnique(current, page.items) : page.items));
      setNextCursor(page.nextCursor);
      setSelectedId((current) =>
        cursor || page.items.some((item) => item.disputeId === current)
          ? current
          : page.items[0]?.disputeId,
      );
    } catch (error) {
      setMessage(errorMessage(error, "صف اختلاف‌ها در دسترس نیست."));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(
    (clearMessage = true) => readQueue(undefined, clearMessage),
    [readQueue],
  );

  useEffect(() => void refresh(), [refresh]);

  useEffect(() => {
    setDetail(undefined);
    setMessage("");
    if (!selected) return;
    const saved = sessionStorage.getItem(accessStorageKey(selected.disputeId));
    if (!saved) {
      setGrantId("");
      setAccessReason("");
      return;
    }
    try {
      const parsed = JSON.parse(saved) as { grantId?: string; reason?: string };
      setGrantId(parsed.grantId ?? "");
      setAccessReason(parsed.reason ?? "");
    } catch {
      sessionStorage.removeItem(accessStorageKey(selected.disputeId));
    }
  }, [selected?.disputeId]);

  async function requestAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/platform/disputes/${selected.disputeId}/access`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            responsibility: "DISPUTE_REVIEW",
            purposeCode: "RESOLVE_ASSIGNED_CASE",
            reason: accessReason,
            scope: {
              resourceType: "DISPUTE_CASE",
              resourceId: selected.disputeId,
              allowedActions: ["REVEAL_MINIMUM", "UPDATE_CASE_STATUS"],
            },
            ttlMinutes: 30,
          }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(humanError(body));
      const grant = platformAccessGrantContract.parse(body);
      if (grant.grantKind !== "SENSITIVE_ACCESS") {
        throw new Error("پاسخ دسترسی با پرونده سازگار نیست.");
      }
      rememberAccess(selected.disputeId, grant.grantId, accessReason);
      setGrantId(grant.grantId);
      setMessage(
        grant.status === "ACTIVE"
          ? "دسترسی تا مهلت نمایش‌داده‌شده فعال شد. پرونده را باز کنید."
          : "درخواست ثبت شد. پس از تأیید مدیر دسترسی، پرونده را دوباره باز کنید.",
      );
    } catch (error) {
      setMessage(errorMessage(error, "درخواست دسترسی ثبت نشد."));
    } finally {
      setPending(false);
    }
  }

  async function reveal() {
    if (!selected) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/platform/disputes/${selected.disputeId}`, {
        cache: "no-store",
        headers: accessHeaders(grantId, accessReason),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(humanError(body));
      const parsed = platformDisputeViewContract.parse(body);
      setDetail(parsed);
      rememberAccess(selected.disputeId, grantId, accessReason);
      setMessage("کمینه اطلاعات لازم این پرونده آشکار و مشاهده در سابقه ثبت شد.");
    } catch (error) {
      setDetail(undefined);
      setMessage(errorMessage(error, "پرونده باز نشد."));
    } finally {
      setPending(false);
    }
  }

  async function mutate(path: "resolution" | "reopening", payload: unknown) {
    if (!selected) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/platform/disputes/${selected.disputeId}/${path}`,
        {
          method: "POST",
          headers: {
            ...accessHeaders(grantId, accessReason),
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify(payload),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(humanError(body));
      setDetail(platformDisputeViewContract.parse(body));
      setMessage(
        path === "resolution"
          ? "نتیجه با دلیل ثبت شد؛ این نتیجه تضمین بازپرداخت نیست."
          : "پرونده با مدرک تازه بازگشایی شد.",
      );
      await refresh(false);
    } catch (error) {
      setMessage(errorMessage(error, "اقدام پرونده ثبت نشد."));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="dispute-title">
        <header className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>فضای کار عامل پلتفرم</p>
            <h1 id="dispute-title">رسیدگی به اختلاف‌ها</h1>
            <p>
              صف فقط خلاصه پرونده را نشان می‌دهد؛ جزئیات با دسترسی زمان‌دار و ثبت‌شده
              آشکار می‌شود.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || pending}
          >
            {loading ? "در حال تازه‌سازی…" : "تازه‌کردن صف"}
          </button>
        </header>

        {message ? (
          <p className={styles.message} role="status">
            {message}
          </p>
        ) : null}
        {!loading && queue.length === 0 ? (
          <p className={styles.empty}>پرونده‌ای در صف اختلاف نیست.</p>
        ) : null}

        <div className={styles.reviewLayout}>
          <aside className={styles.queue} aria-label="صف اختلاف‌ها">
            {queue.map((item) => (
              <button
                type="button"
                key={item.disputeId}
                aria-pressed={selected?.disputeId === item.disputeId}
                onClick={() => setSelectedId(item.disputeId)}
              >
                <strong>{categoryLabels[item.category]}</strong>
                <span>{statusLabels[item.status]}</span>
                <small>پرونده {shortId(item.disputeId)}</small>
                <small>{formatDate(item.openedAt)}</small>
                {item.deadline ? (
                  <small>مهلت: {formatDate(item.deadline.dueAt)}</small>
                ) : null}
              </button>
            ))}
            {nextCursor ? (
              <button
                type="button"
                onClick={() => void readQueue(nextCursor)}
                disabled={loading || pending}
              >
                نمایش پرونده‌های بیشتر
              </button>
            ) : null}
          </aside>

          {selected ? (
            <section className={styles.case} aria-labelledby="selected-case-title">
              <div className={styles.caseHeading}>
                <div>
                  <span>{statusLabels[selected.status]}</span>
                  <h2 id="selected-case-title">{categoryLabels[selected.category]}</h2>
                </div>
                <small>پرونده {shortId(selected.disputeId)}</small>
              </div>

              {!detail ? (
                <AccessPanel
                  disputeId={selected.disputeId}
                  grantId={grantId}
                  reason={accessReason}
                  pending={pending}
                  onGrantId={setGrantId}
                  onReason={setAccessReason}
                  onRequest={requestAccess}
                  onReveal={reveal}
                />
              ) : (
                <DisputeDetails dispute={detail} pending={pending} onMutate={mutate} />
              )}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function AccessPanel({
  disputeId,
  grantId,
  reason,
  pending,
  onGrantId,
  onReason,
  onRequest,
  onReveal,
}: {
  disputeId: string;
  grantId: string;
  reason: string;
  pending: boolean;
  onGrantId: (value: string) => void;
  onReason: (value: string) => void;
  onRequest: (event: FormEvent<HTMLFormElement>) => void;
  onReveal: () => void;
}) {
  return (
    <div className={styles.accessPanel}>
      <p>
        شرح، مدارک و سابقه دو طرف هنوز پوشانده‌اند. برای همین پرونده دسترسی ۳۰ دقیقه‌ای
        بخواهید؛ تأیید مدیر دسترسی لازم است.
      </p>
      <form onSubmit={onRequest}>
        <label>
          دلیل داخلی درخواست دسترسی
          <textarea
            value={reason}
            onChange={(event) => onReason(event.target.value)}
            minLength={10}
            maxLength={1000}
            required
          />
        </label>
        <button className={styles.primary} type="submit" disabled={pending}>
          درخواست دسترسی ۳۰ دقیقه‌ای
        </button>
      </form>
      <details>
        <summary>دسترسی قبلاً واگذار شده است</summary>
        <label>
          شناسه دسترسی همین پرونده
          <input
            value={grantId}
            onChange={(event) => onGrantId(event.target.value)}
            inputMode="text"
            autoComplete="off"
          />
        </label>
      </details>
      <button
        type="button"
        onClick={onReveal}
        disabled={pending || grantId.length < 36 || reason.trim().length < 10}
      >
        بررسی دسترسی و بازکردن پرونده {shortId(disputeId)}
      </button>
    </div>
  );
}

function DisputeDetails({
  dispute,
  pending,
  onMutate,
}: {
  dispute: DisputeView;
  pending: boolean;
  onMutate: (path: "resolution" | "reopening", payload: unknown) => Promise<void>;
}) {
  const action = dispute.platformAction ?? null;
  return (
    <div className={styles.details}>
      <dl>
        <Fact label="سفارش" value={shortId(dispute.orderId)} />
        <Fact label="فروشگاه" value={shortId(dispute.storeId)} />
        <Fact label="دسترسی تا" value={formatDate(dispute.access.expiresAt)} />
        {dispute.deadline ? (
          <Fact label="مهلت پرونده" value={formatDate(dispute.deadline.dueAt)} />
        ) : null}
      </dl>
      <section className={styles.timeline} aria-labelledby="case-timeline-title">
        <h3 id="case-timeline-title">سابقه ثبت‌شده دو طرف</h3>
        {dispute.contributions.map((entry, index) => (
          <article key={`${entry.submittedAt}-${index}`}>
            <div>
              <strong>{actorLabel(entry.authorKind)}</strong>
              <time dateTime={entry.submittedAt}>{formatDate(entry.submittedAt)}</time>
            </div>
            <p>{entry.text}</p>
            {entry.evidence.length ? (
              <small>{entry.evidence.length} مدرک ثبت‌شده</small>
            ) : null}
          </article>
        ))}
      </section>
      {dispute.outcome ? (
        <section className={styles.outcome}>
          <strong>{outcomeLabels[dispute.outcome.code]}</strong>
          <p>{dispute.outcome.explanation}</p>
          <small>این نتیجه در تسویه مستقیم، بازپرداخت را تضمین نمی‌کند.</small>
        </section>
      ) : null}
      {action ? (
        <CaseActionForm action={action} pending={pending} onMutate={onMutate} />
      ) : (
        <p className={styles.nextStep}>
          در وضعیت فعلی اقدام تازه‌ای برای عامل مجاز نیست؛ سابقه پرونده بدون تغییر باقی
          می‌ماند.
        </p>
      )}
    </div>
  );
}

function CaseActionForm({
  action,
  pending,
  onMutate,
}: {
  action: "RESOLVE" | "REOPEN";
  pending: boolean;
  onMutate: (path: "resolution" | "reopening", payload: unknown) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"RESOLVED" | "CLOSED">("RESOLVED");
  const [outcomeCode, setOutcomeCode] = useState<OutcomeCode>(
    "PARTIES_REACHED_AGREEMENT",
  );
  const [violationType, setViolationType] = useState("FULFILLMENT_NONCOMPLIANCE");
  const [evidenceId, setEvidenceId] = useState("");
  const [evidenceKind, setEvidenceKind] = useState<EvidenceKind>("DOCUMENT");
  const [validation, setValidation] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const evidence = evidenceId.trim()
      ? [{ evidenceId: evidenceId.trim(), kind: evidenceKind }]
      : [];
    const payload =
      action === "REOPEN"
        ? { reason: text, evidence }
        : {
            status,
            outcomeCode,
            explanation: text,
            evidence,
            ...(outcomeCode === "VIOLATION_RECORDED" ? { violationType } : {}),
          };
    const parsed =
      action === "REOPEN"
        ? reopenDisputeInputV2Contract.safeParse(payload)
        : resolveDisputeInputV2Contract.safeParse(payload);
    if (!parsed.success) {
      setValidation(
        action === "REOPEN"
          ? "برای بازگشایی، دلیل و شناسه یک مدرک تازه لازم است."
          : "دلیل نتیجه و اطلاعات مدرک را بررسی کنید.",
      );
      return;
    }
    setValidation("");
    void onMutate(action === "REOPEN" ? "reopening" : "resolution", parsed.data);
  }

  return (
    <form className={styles.actionForm} onSubmit={submit}>
      <h3>{action === "REOPEN" ? "بازگشایی با مدرک تازه" : "ثبت نتیجه پرونده"}</h3>
      {action === "RESOLVE" ? (
        <>
          <label>
            وضعیت نتیجه
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
            >
              <option value="RESOLVED">حل‌شده</option>
              <option value="CLOSED">بسته‌شده</option>
            </select>
          </label>
          <label>
            نتیجه ثبت‌شده
            <select
              value={outcomeCode}
              onChange={(event) => setOutcomeCode(event.target.value as OutcomeCode)}
            >
              {Object.entries(outcomeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {outcomeCode === "VIOLATION_RECORDED" ? (
            <label>
              نوع تخلف
              <select
                value={violationType}
                onChange={(event) => setViolationType(event.target.value)}
              >
                <option value="FULFILLMENT_NONCOMPLIANCE">تخلف در انجام سفارش</option>
                <option value="MISREPRESENTATION">معرفی نادرست کالا</option>
                <option value="REFUND_NONCOMPLIANCE">تخلف در بازپرداخت</option>
                <option value="REPEATED_DISPUTES">اختلاف‌های تکرارشونده</option>
                <option value="PLATFORM_POLICY_BREACH">نقض قواعد پلتفرم</option>
              </select>
            </label>
          ) : null}
        </>
      ) : null}
      <label>
        {action === "REOPEN" ? "دلیل بازگشایی" : "توضیح نتیجه برای دو طرف"}
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          minLength={10}
          maxLength={2000}
          required
        />
      </label>
      <div className={styles.evidenceFields}>
        <label>
          شناسه مدرک {action === "REOPEN" ? "تازه" : "(اختیاری)"}
          <input
            value={evidenceId}
            onChange={(event) => setEvidenceId(event.target.value)}
            required={action === "REOPEN"}
          />
        </label>
        <label>
          نوع مدرک
          <select
            value={evidenceKind}
            onChange={(event) => setEvidenceKind(event.target.value as EvidenceKind)}
          >
            <option value="IMAGE">تصویر</option>
            <option value="DOCUMENT">سند</option>
            <option value="MESSAGE_REFERENCE">ارجاع پیام</option>
          </select>
        </label>
      </div>
      {validation ? <p role="alert">{validation}</p> : null}
      <p className={styles.disclaimer}>
        ثبت نتیجه، وضعیت سفارش را پنهانی تغییر نمی‌دهد و در تسویه مستقیم تضمین بازپرداخت
        نیست.
      </p>
      <button className={styles.primary} type="submit" disabled={pending}>
        {pending
          ? "در حال ثبت…"
          : action === "REOPEN"
            ? "بازگشایی پرونده"
            : "ثبت نتیجه"}
      </button>
    </form>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function accessHeaders(grantId: string, reason: string) {
  return {
    "x-platform-access-grant-id": grantId,
    "x-platform-access-reason": encodeURIComponent(reason),
  };
}

function rememberAccess(disputeId: string, grantId: string, reason: string) {
  sessionStorage.setItem(
    accessStorageKey(disputeId),
    JSON.stringify({ grantId, reason }),
  );
}

function accessStorageKey(disputeId: string) {
  return `sevo:platform-dispute-access:${disputeId}`;
}

function actorLabel(actor: DisputeView["contributions"][number]["authorKind"]) {
  return actor === "BUYER" ? "خریدار" : actor === "SELLER" ? "فروشنده" : "عامل پلتفرم";
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function humanError(body: unknown) {
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
  )
    return body.message;
  return "درخواست قابل انجام نیست؛ وضعیت را تازه کنید.";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function appendUnique(current: QueueItem[], next: QueueItem[]) {
  const known = new Set(current.map((item) => item.disputeId));
  return [...current, ...next.filter((item) => !known.has(item.disputeId))];
}
