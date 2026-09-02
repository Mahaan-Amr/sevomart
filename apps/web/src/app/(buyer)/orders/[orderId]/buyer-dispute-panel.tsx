"use client";

import type { FulfillmentTimeline } from "@sevo/contracts/fulfillment/v1";
import { buyerDisputeViewContract } from "@sevo/contracts/problem-follow-up/v1";
import { useEffect, useRef, useState } from "react";

import {
  BuyerDisputeClientError,
  issueBuyerDisputeMediaContext,
  prepareBuyerDisputeImageUpload,
  prepareOpenBuyerDispute,
} from "../../../../lib/buyer-dispute-client";
import { buyerDisputeAvailability } from "../../../../lib/buyer-dispute-availability";
import styles from "./order-tracking.module.css";

type BuyerDispute = ReturnType<typeof buyerDisputeViewContract.parse>;

export function BuyerDisputePanel({
  orderId,
  fulfillment,
  dispute,
  onOpened,
}: {
  orderId: string;
  fulfillment?: FulfillmentTimeline;
  dispute?: BuyerDispute;
  onOpened: (dispute: BuyerDispute) => void;
}) {
  const availability = buyerDisputeAvailability(fulfillment);
  const [formVisible, setFormVisible] = useState(false);
  const [contextId, setContextId] = useState<string>();
  const [category, setCategory] = useState("DAMAGED");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [uploadKey, setUploadKey] = useState<string>();
  const [openKey, setOpenKey] = useState<string>();
  const categoryRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (formVisible) categoryRef.current?.focus();
  }, [formVisible]);

  if (dispute) return <BuyerDisputeTracking dispute={dispute} />;

  if (availability.state === "NOT_STARTED") {
    return (
      <p>
        ثبت اختلاف پس از ارسال سفارش فعال می‌شود. اگر همین حالا پرسشی دارید، از گفت‌وگوی
        سفارش استفاده کنید.
      </p>
    );
  }
  if (availability.state === "CLOSED") {
    return (
      <div className={styles.notice} role="status">
        <strong>مهلت ثبت اختلاف تمام شده است.</strong>
        <p>
          این مهلت در {formatDate(availability.closesAt)} پایان یافت. برای پیگیری بعدی،
          گفت‌وگوی سفارش و سیاست مرجوعی ثبت‌شده را بررسی کنید.
        </p>
      </div>
    );
  }
  if (!formVisible) {
    return (
      <div className={styles.notice}>
        <p>
          تا {formatDate(availability.closesAt)} می‌توانید مشکل این سفارش را ثبت کنید.
          سوو گزارش و تخلف را پیگیری می‌کند، اما بازپرداخت را تضمین نمی‌کند.
        </p>
        <button
          type="button"
          className={styles.primary}
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(undefined);
            try {
              const context = await issueBuyerDisputeMediaContext(orderId);
              setContextId(context.contextId);
              setFormVisible(true);
            } catch (cause) {
              setError(userMessage(cause));
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "در حال بررسی شرایط…" : "ثبت مشکل"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <form
      className={styles.disputeForm}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!contextId || !file || description.trim().length < 10) return;
        setPending(true);
        setError(undefined);
        const stableUploadKey = uploadKey ?? crypto.randomUUID();
        const stableOpenKey = openKey ?? crypto.randomUUID();
        setUploadKey(stableUploadKey);
        setOpenKey(stableOpenKey);
        try {
          const evidence = await prepareBuyerDisputeImageUpload({
            contextId,
            file,
            idempotencyKey: stableUploadKey,
          }).run();
          const opened = await prepareOpenBuyerDispute({
            idempotencyKey: stableOpenKey,
            body: {
              orderId,
              category,
              description,
              evidence: [{ evidenceId: evidence.id, kind: "IMAGE" }],
            },
          }).run();
          onOpened(opened);
        } catch (cause) {
          setError(userMessage(cause));
        } finally {
          setPending(false);
        }
      }}
    >
      <div>
        <label htmlFor="dispute-category">مشکل سفارش</label>
        <select
          id="dispute-category"
          ref={categoryRef}
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setOpenKey(undefined);
          }}
        >
          <option value="DELIVERY_NOT_RECEIVED">سفارش به دستم نرسیده</option>
          <option value="DAMAGED">کالا آسیب‌دیده است</option>
          <option value="NOT_AS_DESCRIBED">کالا با توضیحات مغایرت دارد</option>
          <option value="WRONG_ITEM">کالای دیگری دریافت کرده‌ام</option>
          <option value="REFUND_NOT_COMPLETED">بازپرداخت کامل نشده است</option>
        </select>
      </div>
      <div>
        <label htmlFor="dispute-description">چه اتفاقی افتاده است؟</label>
        <textarea
          id="dispute-description"
          minLength={10}
          maxLength={2_000}
          required
          rows={5}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            setOpenKey(undefined);
          }}
          aria-describedby="dispute-description-help"
        />
        <small id="dispute-description-help">
          با دست‌کم ۱۰ نویسه، مشکل و نتیجه‌ای را که انتظار دارید روشن بنویسید.
        </small>
      </div>
      <div>
        <label htmlFor="dispute-evidence">یک تصویر از مدرک</label>
        <input
          id="dispute-evidence"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          onChange={(event) => {
            setFile(event.target.files?.[0]);
            setUploadKey(undefined);
            setOpenKey(undefined);
          }}
          aria-describedby="dispute-evidence-help"
        />
        <small id="dispute-evidence-help">
          تصویر خصوصی می‌ماند و فقط برای رسیدگی همین پرونده استفاده می‌شود؛ حداکثر ۱۰
          مگابایت.
        </small>
        {file ? <p role="status">یک تصویر برای ثبت انتخاب شد.</p> : null}
      </div>
      <div className={styles.formActions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? "در حال ثبت امن پرونده…" : "ثبت پرونده اختلاف"}
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={pending}
          onClick={() => setFormVisible(false)}
        >
          فعلاً نه
        </button>
      </div>
      <p className={styles.formAssurance}>
        پس از ثبت، فروشگاه برای پاسخ فرصت دارد و قدم بعدی در همین صفحه نشان داده می‌شود.
        در تسویه مستقیم، سوو بازپرداخت را تضمین نمی‌کند.
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

function BuyerDisputeTracking({ dispute }: { dispute: BuyerDispute }) {
  return (
    <div className={styles.disputeTracking}>
      <div className={styles.notice} role="status">
        <strong>پرونده ثبت شده است.</strong>
        <p>
          وضعیت: {statusLabel(dispute.status)}. {nextActionLabel(dispute.nextAction)}
        </p>
        {dispute.deadline ? (
          <p>مهلت قدم بعدی: {formatDate(dispute.deadline.dueAt)}</p>
        ) : null}
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>موضوع</dt>
          <dd>{categoryLabel(dispute.category)}</dd>
        </div>
        <div>
          <dt>زمان ثبت</dt>
          <dd>{formatDate(dispute.openedAt)}</dd>
        </div>
      </dl>
      <h3>سابقه پرونده</h3>
      <ol className={styles.timeline}>
        {dispute.contributions.map((contribution, index) => (
          <li key={`${contribution.submittedAt}-${index}`}>
            <strong>{authorLabel(contribution.authorKind)}</strong>
            <p>{contribution.text}</p>
            <time dateTime={contribution.submittedAt}>
              {formatDate(contribution.submittedAt)}
            </time>
            {contribution.evidence.length ? (
              <span>
                {new Intl.NumberFormat("fa-IR").format(contribution.evidence.length)}{" "}
                مدرک خصوصی ثبت شده است.
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {dispute.outcome ? (
        <div className={styles.notice}>
          <strong>{outcomeLabel(dispute.outcome.code)}</strong>
          <p>{dispute.outcome.explanation}</p>
          <time dateTime={dispute.outcome.decidedAt}>
            {formatDate(dispute.outcome.decidedAt)}
          </time>
        </div>
      ) : null}
      <p>
        سوو گزارش و تخلف را پیگیری می‌کند. چون پرداخت این سفارش تسویه مستقیم بوده،
        بازپرداخت تضمین نمی‌شود؛ قدم بعدی بالا همیشه مرجع پیگیری است.
      </p>
    </div>
  );
}

function userMessage(cause: unknown) {
  return cause instanceof BuyerDisputeClientError
    ? cause.userMessage
    : "ثبت پرونده ممکن نشد. اطلاعات شما حفظ شده است؛ دوباره تلاش کنید.";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(status: BuyerDispute["status"]) {
  return {
    DRAFT: "ثبت اولیه",
    SUBMITTED: "ثبت‌شده",
    AWAITING_SELLER_RESPONSE: "در انتظار پاسخ فروشگاه",
    UNDER_REVIEW: "در حال بررسی سوو",
    RESOLVED: "نتیجه ثبت شده",
    CLOSED: "بسته شده",
  }[status];
}

function categoryLabel(category: BuyerDispute["category"]) {
  return {
    DELIVERY_NOT_RECEIVED: "سفارش نرسیده",
    DAMAGED: "کالای آسیب‌دیده",
    NOT_AS_DESCRIBED: "مغایرت با توضیحات",
    WRONG_ITEM: "کالای اشتباه",
    REFUND_NOT_COMPLETED: "بازپرداخت کامل‌نشده",
  }[category];
}

function authorLabel(author: BuyerDispute["contributions"][number]["authorKind"]) {
  return { BUYER: "شما", SELLER: "فروشگاه", PLATFORM_AGENT: "سوو" }[author];
}

function nextActionLabel(next: BuyerDispute["nextAction"]) {
  return {
    SUBMIT_FIRST_RESPONSE: "اکنون فروشگاه باید پاسخ خود را ثبت کند.",
    REVIEW_CASE: "اکنون سوو پرونده را بررسی می‌کند.",
    WAIT_FOR_PLATFORM: "برای بررسی سوو منتظر بمانید.",
    NO_ACTION: "در حال حاضر اقدامی از شما لازم نیست.",
  }[next.code];
}

function outcomeLabel(code: NonNullable<BuyerDispute["outcome"]>["code"]) {
  return {
    SELLER_ACTION_AGREED: "اقدام فروشگاه ثبت شد",
    PARTIES_REACHED_AGREEMENT: "توافق طرفین ثبت شد",
    POLICY_EXPLAINED: "قواعد مرتبط توضیح داده شد",
    VIOLATION_RECORDED: "تخلف برای پیگیری ثبت شد",
    INSUFFICIENT_EVIDENCE: "مدرک کافی نبود",
    REFERRED_TO_FORMAL_CHANNEL: "پیگیری رسمی لازم است",
  }[code];
}
