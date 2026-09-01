"use client";

import { sellerDisputeViewContract } from "@sevo/contracts/problem-follow-up/v1";
import { respondToDisputeInputV2Contract } from "@sevo/contracts/problem-follow-up/v2";
import { mediaIdContract } from "@sevo/contracts/media/v1";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  contributionAuthorTitle,
  disputeCategoryTitle,
  disputeStatusTitle,
  evidenceKindTitle,
  formatDisputeTime,
} from "./seller-dispute-copy";
import {
  formatOrderReference,
  responseRecoveryMessage,
  sellerNeedsToRespond,
  type SellerDispute,
} from "./seller-dispute-model";
import styles from "./seller-disputes.module.css";

export function SellerDisputeResponse({
  initialDispute,
}: {
  initialDispute: SellerDispute;
}) {
  const [dispute, setDispute] = useState(initialDispute);
  const [response, setResponse] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File>();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [noticeOccurrence, setNoticeOccurrence] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [submissionClosed, setSubmissionClosed] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const uploadedEvidence = useRef<{ file: File; evidenceId: string } | undefined>(
    undefined,
  );
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (noticeOccurrence > 0) noticeRef.current?.focus();
  }, [noticeOccurrence]);

  const deadlinePassed =
    dispute.deadline?.kind === "SELLER_FIRST_RESPONSE" &&
    Date.parse(dispute.deadline.dueAt) <= Date.now();
  const canRespond = sellerNeedsToRespond(dispute) && !submissionClosed;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !respondToDisputeInputV2Contract.safeParse({ response, evidence: [] }).success
    ) {
      setNotice("پاسخ باید دست‌کم ۱۰ نویسه باشد.");
      setNoticeOccurrence((value) => value + 1);
      return;
    }

    setPending(true);
    setNotice(undefined);
    try {
      let evidenceId: string | undefined;
      if (evidenceFile) {
        if (uploadedEvidence.current?.file === evidenceFile) {
          evidenceId = uploadedEvidence.current.evidenceId;
        } else {
          const form = new FormData();
          form.set("file", evidenceFile);
          const upload = await fetch(
            `/api/seller/disputes/${encodeURIComponent(dispute.disputeId)}/evidence`,
            { method: "POST", body: form },
          );
          const uploadBody: unknown = await upload.json();
          const parsedId =
            typeof uploadBody === "object" && uploadBody && "id" in uploadBody
              ? mediaIdContract.safeParse(uploadBody.id)
              : undefined;
          if (!upload.ok || !parsedId?.success) {
            setNotice("تصویر مدرک بارگذاری نشد. فایل را بررسی و دوباره تلاش کنید.");
            setNoticeOccurrence((value) => value + 1);
            return;
          }
          evidenceId = parsedId.data;
          uploadedEvidence.current = { file: evidenceFile, evidenceId };
        }
      }
      const input = respondToDisputeInputV2Contract.parse({
        response,
        evidence: evidenceId ? [{ evidenceId, kind: "IMAGE" }] : [],
      });
      const result = await fetch(
        `/api/seller/disputes/${encodeURIComponent(dispute.disputeId)}/response`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey.current,
          },
          body: JSON.stringify(input),
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
        if (
          [
            "DEADLINE_PASSED",
            "INVALID_TRANSITION",
            "IDEMPOTENCY_CONFLICT",
            "NOT_FOUND",
            "FORBIDDEN",
          ].includes(code)
        ) {
          setSubmissionClosed(true);
          await refreshDispute(dispute.disputeId, setDispute);
        }
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
          بازگشت به پرونده‌های اختلاف
        </Link>
        <span className={styles.eyebrow}>
          شماره سفارش {formatOrderReference(dispute.orderId)}
        </span>
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
          <h2 id="history-title">سابقه ثبت‌شده پرونده</h2>
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

        {deadlinePassed && dispute.status === "AWAITING_SELLER_RESPONSE" ? (
          <p className={styles.notice}>
            مهلت پاسخ پایان یافته و پرونده اکنون در نوبت بررسی سوو است. نتیجه را از همین
            صفحه پیگیری کنید.
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
              <p>یک تصویر متعلق به فروشگاه و مرتبط با همین پرونده بارگذاری کنید.</p>
              <label htmlFor="seller-dispute-evidence">انتخاب تصویر مدرک</label>
              <input
                id="seller-dispute-evidence"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  setEvidenceFile(event.target.files?.[0]);
                  uploadedEvidence.current = undefined;
                }}
              />
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

async function refreshDispute(
  disputeId: string,
  update: (dispute: SellerDispute) => void,
) {
  try {
    const response = await fetch(
      `/api/seller/disputes/${encodeURIComponent(disputeId)}`,
      { cache: "no-store" },
    );
    const parsed = sellerDisputeViewContract.safeParse(await response.json());
    if (response.ok && parsed.success) update(parsed.data);
  } catch {
    // The recovery copy remains useful when the refresh itself is unavailable.
  }
}
