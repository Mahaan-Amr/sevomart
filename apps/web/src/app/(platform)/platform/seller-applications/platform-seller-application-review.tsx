"use client";

import {
  platformSellerApplicationPageContract,
  platformSellerApplicationViewContract,
  type PlatformSellerApplicationPage,
  type PlatformSellerApplicationView,
  type SellerApplicationInput,
} from "@sevo/contracts/identity-access/v1";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import styles from "./platform-seller-application.module.css";

type DecisionKind = "information" | "rejection";
type RequestedField = keyof SellerApplicationInput;
type InformationReasonCode =
  "INFORMATION_INCOMPLETE" | "INFORMATION_INCONSISTENT" | "OTHER";
type RejectionReasonCode =
  "INFORMATION_INCONSISTENT" | "ELIGIBILITY_NOT_ESTABLISHED" | "OTHER";

const fieldLabels: Record<RequestedField, string> = {
  applicantName: "نام و نام خانوادگی",
  proposedStoreName: "نام پیشنهادی فروشگاه",
  goodsAreaText: "حوزه کالا",
  currentSalesMethod: "روش فعلی فروش",
};

const statusLabels: Record<PlatformSellerApplicationView["status"], string> = {
  SUBMITTED: "در انتظار بررسی",
  NEEDS_INFORMATION: "نیاز به تکمیل",
  APPROVED: "تأیید شده",
  REJECTED: "تأیید نشد",
  WITHDRAWN: "پس گرفته شد",
};

const reasonLabels = {
  INFORMATION_INCOMPLETE: "اطلاعات ناقص است",
  INFORMATION_INCONSISTENT: "اطلاعات با هم سازگار نیست",
  ELIGIBILITY_NOT_ESTABLISHED: "شرایط فروشندگی احراز نشد",
  OTHER: "دلیل دیگر",
} as const;

export function PlatformSellerApplicationReview() {
  const [queue, setQueue] = useState<PlatformSellerApplicationPage["items"]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [application, setApplication] = useState<PlatformSellerApplicationView>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [decision, setDecision] = useState<DecisionKind>("information");
  const [informationReasonCode, setInformationReasonCode] =
    useState<InformationReasonCode>("INFORMATION_INCOMPLETE");
  const [rejectionReasonCode, setRejectionReasonCode] = useState<RejectionReasonCode>(
    "ELIGIBILITY_NOT_ESTABLISHED",
  );
  const [publicReason, setPublicReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [requestedFields, setRequestedFields] = useState<RequestedField[]>([
    "currentSalesMethod",
  ]);

  const readApplication = useCallback(async (applicationId: string) => {
    const response = await fetch(`/api/platform/seller-applications/${applicationId}`, {
      cache: "no-store",
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(humanError(body));
    const parsed = platformSellerApplicationViewContract.parse(body);
    setApplication(parsed);
    setSelectedId(applicationId);
  }, []);

  const readQueue = useCallback(
    async (preferredId?: string, cursor?: string) => {
      const response = await fetch(
        `/api/platform/seller-applications?limit=20${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
        }`,
        {
          cache: "no-store",
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(humanError(body));
      const parsed = platformSellerApplicationPageContract.parse(body);
      setQueue((current) => (cursor ? [...current, ...parsed.items] : parsed.items));
      setNextCursor(parsed.nextCursor);
      if (cursor) return;
      const nextId =
        preferredId && parsed.items.some((item) => item.applicationId === preferredId)
          ? preferredId
          : parsed.items[0]?.applicationId;
      if (nextId) await readApplication(nextId);
      else {
        setSelectedId(undefined);
        setApplication(undefined);
      }
    },
    [readApplication],
  );

  useEffect(() => {
    let active = true;
    void readQueue()
      .catch((error: unknown) => {
        if (active) {
          setMessage(
            error instanceof Error ? error.message : "صف درخواست‌ها در دسترس نیست.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [readQueue]);

  async function selectApplication(applicationId: string) {
    setMessage("");
    setLoading(true);
    try {
      await readApplication(applicationId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "پرونده باز نشد.");
    } finally {
      setLoading(false);
    }
  }

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!application || publicReason.trim().length < 5) {
      setMessage("دلیل روشن و قابل‌نمایش را کامل کنید.");
      return;
    }
    if (decision === "information" && requestedFields.length === 0) {
      setMessage("دست‌کم یک بخش را برای تکمیل مشخص کنید.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/platform/seller-applications/${application.applicationId}/${
          decision === "information" ? "information-request" : "rejection"
        }`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedRevision: application.revision,
            reasonCode:
              decision === "information" ? informationReasonCode : rejectionReasonCode,
            publicReason,
            ...(internalNote.trim() ? { internalNote } : {}),
            ...(decision === "information" ? { requestedFields } : {}),
          }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(humanError(body));
      const updated = platformSellerApplicationViewContract.parse(body);
      setApplication(updated);
      setPublicReason("");
      setInternalNote("");
      await readQueue(updated.applicationId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تصمیم ثبت نشد.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span>سوو · عامل پلتفرم</span>
          <h1>بررسی درخواست‌های فروشندگی</h1>
        </div>
        <p>{queue.length} درخواست نیازمند اقدام</p>
      </header>

      {message ? (
        <p className={styles.message} role="alert" aria-live="polite">
          {message}
        </p>
      ) : null}

      <div className={styles.workspace} aria-busy={loading}>
        <aside className={styles.queue} aria-label="صف درخواست‌ها">
          {queue.length === 0 ? (
            <p className={styles.empty}>درخواستی برای بررسی باقی نمانده است.</p>
          ) : (
            <>
              {queue.map((item) => (
                <button
                  type="button"
                  key={item.applicationId}
                  aria-pressed={selectedId === item.applicationId}
                  onClick={() => void selectApplication(item.applicationId)}
                >
                  <strong>{item.proposedStoreName}</strong>
                  <span>{item.applicantName}</span>
                  <small>{statusLabels[item.status]}</small>
                </button>
              ))}
              {nextCursor ? (
                <button
                  type="button"
                  className={styles.loadMore}
                  onClick={() => void readQueue(undefined, nextCursor)}
                >
                  نمایش درخواست‌های بیشتر
                </button>
              ) : null}
            </>
          )}
        </aside>

        <section className={styles.case} aria-labelledby="case-title">
          {application ? (
            <>
              <div className={styles.caseHeading}>
                <div>
                  <span>درخواست فروشندگی</span>
                  <h2 id="case-title">
                    {application.currentPayload.proposedStoreName}
                  </h2>
                </div>
                <strong>{statusLabels[application.status]}</strong>
              </div>
              <dl className={styles.facts}>
                {(Object.keys(fieldLabels) as RequestedField[]).map((field) => (
                  <div key={field}>
                    <dt>{fieldLabels[field]}</dt>
                    <dd>{application.currentPayload[field]}</dd>
                  </div>
                ))}
              </dl>
              {application.decisions.length > 0 ? (
                <details className={styles.history}>
                  <summary>سابقه تصمیم‌ها ({application.decisions.length})</summary>
                  <ol>
                    {application.decisions.map((entry) => (
                      <li key={`${entry.revision}-${entry.occurredAt}`}>
                        <strong>
                          {entry.action === "REQUEST_INFORMATION"
                            ? "درخواست تکمیل"
                            : "رد درخواست"}
                        </strong>
                        <p>{entry.publicReason}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              {application.status === "SUBMITTED" && !application.isSelfReview ? (
                <form className={styles.decision} onSubmit={submitDecision}>
                  <fieldset>
                    <legend>تصمیم این بررسی</legend>
                    <label>
                      <input
                        type="radio"
                        name="decision"
                        checked={decision === "information"}
                        onChange={() => setDecision("information")}
                      />
                      درخواست تکمیل
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="decision"
                        checked={decision === "rejection"}
                        onChange={() => setDecision("rejection")}
                      />
                      رد درخواست
                    </label>
                  </fieldset>
                  {decision === "information" ? (
                    <fieldset className={styles.fields}>
                      <legend>کدام بخش باید تکمیل شود؟</legend>
                      {(Object.keys(fieldLabels) as RequestedField[]).map((field) => (
                        <label key={field}>
                          <input
                            type="checkbox"
                            checked={requestedFields.includes(field)}
                            onChange={(event) =>
                              setRequestedFields((current) =>
                                event.target.checked
                                  ? [...current, field]
                                  : current.filter((item) => item !== field),
                              )
                            }
                          />
                          {fieldLabels[field]}
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                  <label className={styles.textField}>
                    <span>کد دلیل</span>
                    <select
                      value={
                        decision === "information"
                          ? informationReasonCode
                          : rejectionReasonCode
                      }
                      onChange={(event) => {
                        if (decision === "information") {
                          setInformationReasonCode(
                            event.target.value as InformationReasonCode,
                          );
                        } else {
                          setRejectionReasonCode(
                            event.target.value as RejectionReasonCode,
                          );
                        }
                      }}
                    >
                      {(decision === "information"
                        ? ([
                            "INFORMATION_INCOMPLETE",
                            "INFORMATION_INCONSISTENT",
                            "OTHER",
                          ] as const)
                        : ([
                            "INFORMATION_INCONSISTENT",
                            "ELIGIBILITY_NOT_ESTABLISHED",
                            "OTHER",
                          ] as const)
                      ).map((code) => (
                        <option key={code} value={code}>
                          {reasonLabels[code]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.textField}>
                    <span>دلیل قابل‌نمایش به متقاضی</span>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={publicReason}
                      onChange={(event) => setPublicReason(event.target.value)}
                    />
                  </label>
                  <label className={styles.textField}>
                    <span>یادداشت داخلی (اختیاری)</span>
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={internalNote}
                      onChange={(event) => setInternalNote(event.target.value)}
                    />
                  </label>
                  <button type="submit" disabled={pending}>
                    {pending
                      ? "در حال ثبت…"
                      : decision === "information"
                        ? "ثبت درخواست تکمیل"
                        : "ثبت رد درخواست"}
                  </button>
                </form>
              ) : application.isSelfReview ? (
                <p className={styles.closed}>
                  این درخواست متعلق به شماست؛ آن را فقط بخوانید و برای تصمیم به عامل
                  دیگری بسپارید.
                </p>
              ) : (
                <p className={styles.closed}>
                  این درخواست اکنون قابل تصمیم‌گیری نیست؛ وضعیت تازه در صف اعمال شده
                  است.
                </p>
              )}
            </>
          ) : (
            <p className={styles.empty} id="case-title">
              یک درخواست را از صف انتخاب کنید.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function humanError(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    return value.message;
  }
  return "درخواست انجام نشد. دوباره تلاش کنید.";
}
