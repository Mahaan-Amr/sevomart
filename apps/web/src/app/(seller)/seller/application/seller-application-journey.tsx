"use client";

import {
  mySellerApplicationsContract,
  sellerApplicationViewContract,
  type SellerApplicationInput,
  type SellerApplicationView,
} from "@sevo/contracts/identity-access/v1";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";

import styles from "./seller-application.module.css";

type Draft = SellerApplicationInput & {
  step: number;
  idempotencyKey: string;
  applicationRevision: number | null;
  startedAfterApplicationId: string | null;
};

const fields = [
  {
    key: "applicantName",
    label: "نام و نام خانوادگی",
    help: "نامی که بتوانیم شما را با آن خطاب کنیم.",
    maxLength: 80,
    multiline: false,
  },
  {
    key: "proposedStoreName",
    label: "نام پیشنهادی فروشگاه",
    help: "بعداً می‌توانید این نام را تغییر دهید.",
    maxLength: 80,
    multiline: false,
  },
  {
    key: "goodsAreaText",
    label: "چه کالاهایی می‌فروشید؟",
    help: "کوتاه بنویسید؛ مثلاً پوشاک دست‌دوز یا قهوه و ابزار دم‌آوری.",
    maxLength: 120,
    multiline: true,
  },
  {
    key: "currentSalesMethod",
    label: "الان چطور می‌فروشید؟",
    help: "مثلاً از راه اینستاگرام، پیام‌رسان یا فروش حضوری.",
    maxLength: 240,
    multiline: true,
  },
] as const;

function emptyDraft(startedAfterApplicationId: string | null = null): Draft {
  return {
    applicantName: "",
    proposedStoreName: "",
    goodsAreaText: "",
    currentSalesMethod: "",
    step: 0,
    idempotencyKey: crypto.randomUUID(),
    applicationRevision: null,
    startedAfterApplicationId,
  };
}

export function SellerApplicationJourney({
  draftStorageKey,
}: {
  draftStorageKey: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [application, setApplication] = useState<SellerApplicationView>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [withdrawalPending, setWithdrawalPending] = useState(false);
  const [withdrawalKey, setWithdrawalKey] = useState(() =>
    persistentWithdrawalKey(draftStorageKey),
  );
  const [message, setMessage] = useState("");
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    const saved = readSavedDraft(draftStorageKey);
    setDraft(saved ?? emptyDraft());

    let active = true;
    void fetch("/api/seller-applications/mine", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign("/seller/login?returnTo=%2Fseller%2Fapplication");
          return;
        }
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(humanError(body));
        const parsed = mySellerApplicationsContract.parse(body);
        const current = parsed.items[0];
        if (!active || !current) return;
        if (current.status === "NEEDS_INFORMATION") {
          setApplication(current);
          const requested = [...current.timeline]
            .reverse()
            .find((entry) => entry.requestedFields.length > 0)?.requestedFields[0];
          const step = Math.max(
            0,
            fields.findIndex((field) => field.key === requested),
          );
          setDraft((loadedDraft) =>
            loadedDraft?.applicationRevision === current.currentRevision
              ? loadedDraft
              : {
                  ...current.currentPayload,
                  step,
                  idempotencyKey: crypto.randomUUID(),
                  applicationRevision: current.currentRevision,
                  startedAfterApplicationId: null,
                },
          );
        } else if (
          (current.status === "WITHDRAWN" || current.status === "REJECTED") &&
          saved?.startedAfterApplicationId === current.applicationId
        ) {
          setApplication(undefined);
        } else {
          setApplication(current);
          localStorage.removeItem(draftStorageKey);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setMessage(
            error instanceof Error
              ? error.message
              : "پیگیری درخواست در دسترس نیست. دوباره تلاش کنید.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [draftStorageKey]);

  useEffect(() => {
    if (draft) localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [draft, draftStorageKey]);

  useEffect(() => {
    if (!loading) fieldRef.current?.focus();
  }, [application?.status, draft?.step, loading]);

  if (loading || !draft) {
    return <JourneyShell message="در حال آماده‌کردن درخواست شما…" />;
  }

  async function withdrawApplication() {
    if (!application || !window.confirm("می‌خواهید این درخواست را پس بگیرید؟")) {
      return;
    }
    setWithdrawalPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/seller-applications/${application.applicationId}/withdrawal`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": withdrawalKey,
          },
          body: JSON.stringify({ expectedRevision: application.currentRevision }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(humanError(body));
        return;
      }
      const withdrawn = sellerApplicationViewContract.parse(body);
      localStorage.removeItem(draftStorageKey);
      localStorage.removeItem(`${draftStorageKey}:withdrawal`);
      setWithdrawalKey(persistentWithdrawalKey(draftStorageKey));
      setApplication(withdrawn);
    } catch {
      setMessage("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setWithdrawalPending(false);
    }
  }

  if (application && application.status !== "NEEDS_INFORMATION") {
    return (
      <ApplicationStatus
        application={application}
        message={message}
        withdrawalPending={withdrawalPending}
        onWithdraw={withdrawApplication}
        onStartNew={() => {
          localStorage.removeItem(draftStorageKey);
          localStorage.removeItem(`${draftStorageKey}:withdrawal`);
          setWithdrawalKey(persistentWithdrawalKey(draftStorageKey));
          setApplication(undefined);
          setDraft(emptyDraft(application.applicationId));
        }}
      />
    );
  }

  const field = fields[draft.step] ?? fields[0];
  const currentDraft = draft;
  const value = draft[field.key];
  const canContinue = value.trim().length >= 2;
  const isLast = draft.step === fields.length - 1;
  const reason = application
    ? [...application.timeline].reverse().find((entry) => entry.publicReason)
        ?.publicReason
    : null;

  async function continueJourney(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!canContinue) {
      setMessage("این بخش را با دست‌کم دو نویسه کامل کنید.");
      return;
    }
    if (!isLast) {
      setDraft((current) =>
        current ? { ...current, step: Math.min(current.step + 1, 3) } : current,
      );
      return;
    }

    setPending(true);
    try {
      const { idempotencyKey } = currentDraft;
      const payload: SellerApplicationInput = {
        applicantName: currentDraft.applicantName,
        proposedStoreName: currentDraft.proposedStoreName,
        goodsAreaText: currentDraft.goodsAreaText,
        currentSalesMethod: currentDraft.currentSalesMethod,
      };
      const resubmitting = application?.status === "NEEDS_INFORMATION";
      const response = await fetch(
        resubmitting
          ? `/api/seller-applications/${application.applicationId}/resubmission`
          : "/api/seller-applications",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify(
            resubmitting
              ? { ...payload, expectedRevision: application.currentRevision }
              : payload,
          ),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(humanError(body));
        return;
      }
      const submitted = sellerApplicationViewContract.parse(body);
      localStorage.removeItem(draftStorageKey);
      setApplication(submitted);
    } catch {
      setMessage("ارتباط با سرور برقرار نشد. اطلاعات شما حفظ شده؛ دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="application-title">
        <header className={styles.header}>
          <span className={styles.brand}>سوو</span>
          <span
            className={styles.progress}
            aria-label={`پیش‌نویس، قدم ${draft.step + 1} از ۴`}
          >
            پیش‌نویس · {draft.step + 1} از ۴
          </span>
        </header>
        <h1 id="application-title">درخواست فروشندگی</h1>
        {reason ? <p className={styles.reason}>{reason}</p> : null}
        <form className={styles.form} onSubmit={continueJourney} noValidate>
          <label htmlFor={`application-${field.key}`}>{field.label}</label>
          <p id="application-field-help" className={styles.help}>
            {field.help}
          </p>
          {field.multiline ? (
            <textarea
              ref={fieldRef as RefObject<HTMLTextAreaElement>}
              id={`application-${field.key}`}
              value={value}
              maxLength={field.maxLength}
              rows={4}
              aria-describedby="application-field-help application-message"
              onChange={(event) =>
                setDraft({ ...draft, [field.key]: event.target.value })
              }
            />
          ) : (
            <input
              ref={fieldRef as RefObject<HTMLInputElement>}
              id={`application-${field.key}`}
              value={value}
              maxLength={field.maxLength}
              autoComplete={field.key === "applicantName" ? "name" : "off"}
              aria-describedby="application-field-help application-message"
              onChange={(event) =>
                setDraft({ ...draft, [field.key]: event.target.value })
              }
            />
          )}
          <p
            id="application-message"
            className={styles.message}
            role="alert"
            aria-live="polite"
          >
            {message}
          </p>
          <div className={styles.actions}>
            <button type="submit" disabled={pending}>
              {pending
                ? "در حال ثبت…"
                : isLast
                  ? application
                    ? "ثبت اطلاعات تکمیلی"
                    : "ثبت درخواست"
                  : "ادامه"}
            </button>
            {draft.step > 0 ? (
              <button
                type="button"
                className={styles.secondary}
                onClick={() =>
                  setDraft({ ...draft, step: Math.max(draft.step - 1, 0) })
                }
              >
                بازگشت
              </button>
            ) : null}
            {application?.status === "NEEDS_INFORMATION" ? (
              <button
                type="button"
                className={styles.danger}
                disabled={withdrawalPending}
                onClick={withdrawApplication}
              >
                {withdrawalPending ? "در حال بستن…" : "پس‌گرفتن درخواست"}
              </button>
            ) : null}
          </div>
        </form>
        <a className={styles.leave} href="/">
          بعداً ادامه می‌دهم
        </a>
      </section>
    </main>
  );
}

function ApplicationStatus({
  application,
  message,
  withdrawalPending,
  onWithdraw,
  onStartNew,
}: {
  application: SellerApplicationView;
  message: string;
  withdrawalPending: boolean;
  onWithdraw: () => void;
  onStartNew: () => void;
}) {
  const content = statusContent(application);
  const publicReason = [...application.timeline]
    .reverse()
    .find((entry) => entry.publicReason)?.publicReason;
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="application-status-title">
        <span className={styles.brand}>سوو</span>
        <p className={styles.statusLabel}>{content.label}</p>
        <h1 id="application-status-title">{content.title}</h1>
        <p>{content.nextStep}</p>
        {publicReason ? <p className={styles.reason}>{publicReason}</p> : null}
        {message ? (
          <p className={styles.message} role="alert">
            {message}
          </p>
        ) : null}
        {application.status === "SUBMITTED" ? (
          <button
            type="button"
            className={styles.danger}
            disabled={withdrawalPending}
            onClick={onWithdraw}
          >
            {withdrawalPending ? "در حال بستن…" : "پس‌گرفتن درخواست"}
          </button>
        ) : null}
        {application.status === "WITHDRAWN" || application.status === "REJECTED" ? (
          <button type="button" className={styles.primaryAction} onClick={onStartNew}>
            ثبت درخواست تازه
          </button>
        ) : null}
        <a className={styles.leave} href="/">
          بازگشت به سوو
        </a>
      </section>
    </main>
  );
}

function JourneyShell({ message }: { message: string }) {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-live="polite">
        <span className={styles.brand}>سوو</span>
        <p>{message}</p>
      </section>
    </main>
  );
}

function statusContent(application: SellerApplicationView) {
  if (application.status === "APPROVED") {
    return {
      label: "تأییدشده",
      title: "درخواست شما تأیید شد.",
      nextStep: "قدم بعدی: ساخت فروشگاه را شروع کنید.",
    };
  }
  if (application.status === "REJECTED") {
    return {
      label: "پایان بررسی",
      title: "این درخواست تأیید نشد.",
      nextStep: "دلیل بررسی را پایین‌تر می‌بینید.",
    };
  }
  if (application.status === "WITHDRAWN") {
    return {
      label: "پس‌گرفته‌شده",
      title: "این درخواست بسته شده است.",
      nextStep: "در صورت نیاز می‌توانید درخواست تازه‌ای ثبت کنید.",
    };
  }
  return {
    label: "در حال بررسی",
    title: "درخواست شما ثبت شد.",
    nextStep: "قدم بعدی: نتیجه بررسی را همین‌جا می‌بینید.",
  };
}

function readSavedDraft(storageKey: string): Draft | undefined {
  try {
    const value = localStorage.getItem(storageKey);
    if (!value) return undefined;
    const parsed = JSON.parse(value) as Partial<Draft>;
    if (
      typeof parsed.applicantName !== "string" ||
      typeof parsed.proposedStoreName !== "string" ||
      typeof parsed.goodsAreaText !== "string" ||
      typeof parsed.currentSalesMethod !== "string" ||
      typeof parsed.step !== "number" ||
      typeof parsed.idempotencyKey !== "string" ||
      !(
        parsed.applicationRevision === null ||
        typeof parsed.applicationRevision === "number"
      ) ||
      !(
        parsed.startedAfterApplicationId === null ||
        typeof parsed.startedAfterApplicationId === "string"
      )
    ) {
      return undefined;
    }
    return { ...parsed, step: Math.min(Math.max(parsed.step, 0), 3) } as Draft;
  } catch {
    return undefined;
  }
}

function persistentWithdrawalKey(storageKey: string): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const key = `${storageKey}:withdrawal`;
  const saved = localStorage.getItem(key);
  if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

function humanError(body: unknown): string {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "درخواست انجام نشد. دوباره تلاش کنید.";
}
