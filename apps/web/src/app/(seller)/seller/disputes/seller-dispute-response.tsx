"use client";

import { sellerDisputeViewContract } from "@sevo/contracts/problem-follow-up/v1";
import {
  disputeEvidenceInputV2Contract,
  respondToDisputeInputV2Contract,
} from "@sevo/contracts/problem-follow-up/v2";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  contributionAuthorTitle,
  disputeCategoryTitle,
  disputeStatusTitle,
  evidenceKindTitle,
  formatDisputeTime,
} from "./seller-dispute-copy";
import { responseRecoveryMessage, type SellerDispute } from "./seller-dispute-model";
import styles from "./seller-disputes.module.css";

type EvidenceDraft = {
  evidenceId: string;
  kind: "IMAGE" | "DOCUMENT" | "MESSAGE_REFERENCE";
};

export function SellerDisputeResponse({
  initialDispute,
}: {
  initialDispute: SellerDispute;
}) {
  const [dispute, setDispute] = useState(initialDispute);
  const [response, setResponse] = useState("");
  const [evidence, setEvidence] = useState<EvidenceDraft[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [noticeOccurrence, setNoticeOccurrence] = useState(0);
  const [completed, setCompleted] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (noticeOccurrence > 0) noticeRef.current?.focus();
  }, [noticeOccurrence]);

  const deadlinePassed =
    dispute.deadline?.kind === "SELLER_FIRST_RESPONSE" &&
    Date.parse(dispute.deadline.dueAt) <= Date.now();
  const canRespond =
    dispute.nextAction.actorKind === "SELLER" &&
    dispute.nextAction.code === "SUBMIT_FIRST_RESPONSE" &&
    !deadlinePassed;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsedEvidence = evidence.map((item) =>
      disputeEvidenceInputV2Contract.safeParse({
        evidenceId: item.evidenceId.trim(),
        kind: item.kind,
      }),
    );
    const input = respondToDisputeInputV2Contract.safeParse({
      response,
      evidence: parsedEvidence.every((item) => item.success)
        ? parsedEvidence.map((item) => item.data)
        : evidence,
    });
    if (!input.success) {
      setNotice(
        "پاسخ باید دست‌کم ۱۰ نویسه باشد و شناسه هر مدرک باید کامل و معتبر باشد.",
      );
      setNoticeOccurrence((value) => value + 1);
      return;
    }

    setPending(true);
    setNotice(undefined);
    try {
      const result = await fetch(
        `/api/seller/disputes/${encodeURIComponent(dispute.disputeId)}/response`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey.current,
          },
          body: JSON.stringify(input.data),
        },
      );
      const body: unknown = await result.json();
      if (result.status === 401) {
        window.location.assign("/seller/login");
        return;
      }
      const parsed = sellerDisputeViewContract.safeParse(body);
      if (!result.ok || !parsed.success) {
        const code = readErrorCode(body);
        setNotice(responseRecoveryMessage(code));
        setNoticeOccurrence((value) => value + 1);
        return;
      }
      setDispute(parsed.data);
      setCompleted(true);
      setNotice("پاسخ فروشگاه ثبت شد و پرونده برای بررسی سوو فرستاده شد.");
      setNoticeOccurrence((value) => value + 1);
      idempotencyKey.current = crypto.randomUUID();
    } catch {
      setNotice("ارتباط برقرار نشد. دوباره تلاش کنید؛ پاسخ تکراری ثبت نخواهد شد.");
      setNoticeOccurrence((value) => value + 1);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="dispute-title">
        <Link className={styles.back} href="/seller/disputes">
          بازگشت به اختلاف‌ها
        </Link>
        <span className={styles.eyebrow}>سفارش {dispute.orderId}</span>
        <h1 id="dispute-title">{disputeCategoryTitle(dispute.category)}</h1>
        <div className={styles.summary}>
          <span>{disputeStatusTitle(dispute.status)}</span>
          {dispute.deadline ? (
            <time dateTime={dispute.deadline.dueAt}>
              مهلت پاسخ: {formatDisputeTime(dispute.deadline.dueAt)}
            </time>
          ) : null}
        </div>

        {notice ? (
          <p
            className={completed ? styles.success : styles.error}
            role={completed ? "status" : "alert"}
            ref={noticeRef}
            tabIndex={-1}
          >
            {notice}
          </p>
        ) : null}

        <section className={styles.history} aria-labelledby="history-title">
          <h2 id="history-title">گفت‌وگوی ثبت‌شده پرونده</h2>
          <ol>
            {dispute.contributions.map((contribution, index) => (
              <li key={`${contribution.submittedAt}-${index}`}>
                <div>
                  <strong>{contributionAuthorTitle(contribution.authorKind)}</strong>
                  <time dateTime={contribution.submittedAt}>
                    {formatDisputeTime(contribution.submittedAt)}
                  </time>
                </div>
                <p>{contribution.text}</p>
                {contribution.evidence.length ? (
                  <ul aria-label="مدارک این پاسخ">
                    {contribution.evidence.map((item) => (
                      <li key={item.evidenceId}>{evidenceKindTitle(item.kind)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        {dispute.outcome ? (
          <section className={styles.outcome} aria-labelledby="outcome-title">
            <h2 id="outcome-title">نتیجه پرونده</h2>
            <p>{dispute.outcome.explanation}</p>
            <time dateTime={dispute.outcome.decidedAt}>
              {formatDisputeTime(dispute.outcome.decidedAt)}
            </time>
          </section>
        ) : null}

        {deadlinePassed && dispute.nextAction.actorKind === "SELLER" ? (
          <p className={styles.notice}>
            مهلت پاسخ گذشته است. صفحه را تازه کنید تا قدم بعدی پرونده روشن شود.
          </p>
        ) : null}

        {canRespond ? (
          <form className={styles.form} onSubmit={submit} noValidate>
            <h2>پاسخ فروشگاه</h2>
            <label htmlFor="seller-dispute-response">توضیح شما</label>
            <textarea
              id="seller-dispute-response"
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              minLength={10}
              maxLength={2000}
              rows={6}
              required
            />
            <small>روشن بنویسید چه اتفاقی افتاده و قدم بعدی فروشگاه چیست.</small>

            <fieldset>
              <legend>مدرک مرتبط (اختیاری)</legend>
              <p>
                اگر مدرکی از مسیر امن سوو آماده کرده‌اید، شناسه و نوع آن را اضافه کنید.
              </p>
              {evidence.map((item, index) => (
                <div className={styles.evidenceRow} key={index}>
                  <label>
                    شناسه مدرک
                    <input
                      value={item.evidenceId}
                      onChange={(event) =>
                        setEvidence((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, evidenceId: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    نوع مدرک
                    <select
                      value={item.kind}
                      onChange={(event) =>
                        setEvidence((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? {
                                  ...entry,
                                  kind: event.target.value as EvidenceDraft["kind"],
                                }
                              : entry,
                          ),
                        )
                      }
                    >
                      <option value="IMAGE">تصویر</option>
                      <option value="DOCUMENT">سند</option>
                      <option value="MESSAGE_REFERENCE">پیام مرتبط</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setEvidence((current) =>
                        current.filter((_, entryIndex) => entryIndex !== index),
                      )
                    }
                  >
                    حذف مدرک
                  </button>
                </div>
              ))}
              {evidence.length < 10 ? (
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() =>
                    setEvidence((current) => [
                      ...current,
                      { evidenceId: "", kind: "IMAGE" },
                    ])
                  }
                >
                  افزودن مدرک
                </button>
              ) : null}
            </fieldset>
            <button className={styles.primaryButton} type="submit" disabled={pending}>
              {pending ? "در حال ثبت…" : "ثبت پاسخ فروشگاه"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}

function readErrorCode(body: unknown) {
  return typeof body === "object" && body && "code" in body
    ? String(body.code)
    : "UNKNOWN";
}
