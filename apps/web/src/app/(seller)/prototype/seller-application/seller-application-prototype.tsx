"use client";

import { useMemo, useState } from "react";

import {
  PrototypeSwitcher,
  type PrototypeVariant,
  usePrototypeVariant,
} from "./prototype-switcher";
import styles from "./prototype.module.css";

type Journey = "applicant" | "agent";
type ApplicationStatus = "draft" | "submitted" | "needs-info" | "approved" | "rejected";

type AuditEvent = {
  id: number;
  title: string;
  detail: string;
  actor: string;
  time: string;
};

const statusCopy: Record<ApplicationStatus, { label: string; hint: string }> = {
  draft: {
    label: "پیش‌نویس",
    hint: "اطلاعات هنوز برای بررسی سوو فرستاده نشده است.",
  },
  submitted: {
    label: "در انتظار بررسی",
    hint: "درخواست ثبت شده و نتیجه از همین صفحه قابل پیگیری است.",
  },
  "needs-info": {
    label: "نیاز به تکمیل",
    hint: "عامل پلتفرم یک مورد مشخص را برای تکمیل برگردانده است.",
  },
  approved: {
    label: "تأیید شده",
    hint: "دسترسی فروشندگی فعال شده و قدم بعدی ساخت فروشگاه است.",
  },
  rejected: {
    label: "تأیید نشد",
    hint: "دلیل تصمیم ثبت شده و درخواست تازه بعداً امکان‌پذیر است.",
  },
};

const initialAudit: AuditEvent[] = [
  {
    id: 1,
    title: "درخواست ثبت شد",
    detail: "اطلاعات کسب‌وکار و روش تماس برای بررسی فرستاده شد.",
    actor: "مریم احمدی · متقاضی",
    time: "امروز، ۱۰:۲۴",
  },
  {
    id: 2,
    title: "درخواست وارد صف بررسی شد",
    detail: "هنوز تصمیمی ثبت نشده است.",
    actor: "سامانه سوو",
    time: "امروز، ۱۰:۲۴",
  },
];

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function StatusPill({ status }: { status: ApplicationStatus }) {
  return (
    <span className={cx(styles.statusPill, styles[status])}>
      {statusCopy[status].label}
    </span>
  );
}

function Brand() {
  return (
    <a
      className={styles.brand}
      href="#prototype-main"
      aria-label="سوو، رفتن به محتوای اصلی"
    >
      سوو
    </a>
  );
}

function JourneyHeader({
  journey,
  onJourney,
  status,
}: {
  journey: Journey;
  onJourney: (journey: Journey) => void;
  status: ApplicationStatus;
}) {
  return (
    <header className={styles.prototypeHeader}>
      <Brand />
      <div className={styles.journeyTabs} aria-label="انتخاب نمای نمونه">
        <button
          type="button"
          aria-pressed={journey === "applicant"}
          className={journey === "applicant" ? styles.selectedJourney : ""}
          onClick={() => onJourney("applicant")}
        >
          نمای متقاضی
        </button>
        <button
          type="button"
          aria-pressed={journey === "agent"}
          className={journey === "agent" ? styles.selectedJourney : ""}
          onClick={() => onJourney("agent")}
        >
          نمای عامل پلتفرم
        </button>
      </div>
      <StatusPill status={status} />
    </header>
  );
}

function ApplicantFacts() {
  return (
    <dl className={styles.facts}>
      <div>
        <dt>نام و نام خانوادگی</dt>
        <dd>مریم احمدی</dd>
      </div>
      <div>
        <dt>نام پیشنهادی فروشگاه</dt>
        <dd>خانه نارون</dd>
      </div>
      <div>
        <dt>حوزه کالا</dt>
        <dd>لوازم خانه دست‌ساز</dd>
      </div>
      <div>
        <dt>روش فعلی فروش</dt>
        <dd>اینستاگرام و پیام‌رسان</dd>
      </div>
      <div>
        <dt>شماره تأییدشده</dt>
        <dd dir="ltr">۰۹۱۲•••۴۲۸۱</dd>
      </div>
    </dl>
  );
}

function AuditTrail({ events }: { events: AuditEvent[] }) {
  return (
    <ol className={styles.auditTrail}>
      {[...events].reverse().map((event) => (
        <li key={event.id}>
          <span aria-hidden="true" />
          <div>
            <strong>{event.title}</strong>
            <p>{event.detail}</p>
            <small>
              {event.actor} · {event.time}
            </small>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ApplicantDecision({
  status,
  events,
  onSubmit,
}: {
  status: ApplicationStatus;
  events: AuditEvent[];
  onSubmit: () => void;
}) {
  return (
    <section
      className={styles.applicantDecision}
      aria-labelledby="applicant-status-title"
    >
      <div className={styles.statusLead}>
        <h2 id="applicant-status-title">{statusCopy[status].label}</h2>
        <p>{statusCopy[status].hint}</p>
      </div>
      {status === "draft" ? (
        <button type="button" className={styles.primaryButton} onClick={onSubmit}>
          ثبت درخواست برای بررسی
        </button>
      ) : null}
      {status === "needs-info" ? (
        <button type="button" className={styles.primaryButton} onClick={onSubmit}>
          تکمیل و ارسال دوباره
        </button>
      ) : null}
      {status === "approved" ? (
        <button type="button" className={styles.primaryButton}>
          شروع ساخت فروشگاه
        </button>
      ) : null}
      <AuditTrail events={events} />
    </section>
  );
}

function DecisionPanel({
  status,
  reason,
  onReason,
  selfReview,
  onSelfReview,
  onDecision,
}: {
  status: ApplicationStatus;
  reason: string;
  onReason: (reason: string) => void;
  selfReview: boolean;
  onSelfReview: (selfReview: boolean) => void;
  onDecision: (status: Exclude<ApplicationStatus, "draft" | "submitted">) => void;
}) {
  if (status === "approved" || status === "rejected") {
    return (
      <section className={styles.decisionPanel} aria-labelledby="decision-title">
        <div className={styles.completedDecision}>
          <StatusPill status={status} />
          <div>
            <h2 id="decision-title">تصمیم ثبت شد و قابل بازنویسی نیست</h2>
            <p>
              دلیل و هویت عامل در سابقه ممیزی مانده است. هر اقدام بعدی باید جریان و مجوز
              جداگانه داشته باشد.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.decisionPanel} aria-labelledby="decision-title">
      <div className={styles.decisionHeading}>
        <div>
          <span>تصمیم این بررسی</span>
          <h2 id="decision-title">دلیل را پیش از اقدام ثبت کنید</h2>
        </div>
        <label className={styles.scenarioToggle}>
          <input
            type="checkbox"
            checked={selfReview}
            onChange={(event) => onSelfReview(event.target.checked)}
          />
          شبیه‌سازی خودبررسی
        </label>
      </div>
      {selfReview ? (
        <div className={styles.blockedNotice} role="alert">
          <strong>این درخواست را خودتان ثبت کرده‌اید.</strong>
          <span>برای جلوگیری از خودتأییدی، تصمیم باید به عامل دیگری واگذار شود.</span>
        </div>
      ) : null}
      <label className={styles.reasonField}>
        <span>دلیل قابل ممیزی</span>
        <textarea
          value={reason}
          onChange={(event) => onReason(event.target.value)}
          placeholder="مثلاً: اطلاعات کسب‌وکار روشن است و شماره تماس تأیید شده."
          rows={3}
        />
        <small>
          این متن در سابقه درخواست می‌ماند و نتیجه مناسب به متقاضی نمایش داده می‌شود.
        </small>
      </label>
      <div className={styles.decisionActions}>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={selfReview || !reason.trim()}
          onClick={() => onDecision("needs-info")}
        >
          درخواست تکمیل
        </button>
        <button
          type="button"
          className={styles.dangerButton}
          disabled={selfReview || !reason.trim()}
          onClick={() => onDecision("rejected")}
        >
          رد درخواست
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={selfReview || !reason.trim()}
          onClick={() => onDecision("approved")}
        >
          تأیید فروشندگی
        </button>
      </div>
    </section>
  );
}

function AgentCase({
  events,
  status,
}: {
  events: AuditEvent[];
  status: ApplicationStatus;
}) {
  return (
    <section className={styles.caseContent} aria-labelledby="case-title">
      <div className={styles.caseTitleRow}>
        <div>
          <span>درخواست فروشندگی</span>
          <h1 id="case-title">خانه نارون</h1>
          <p>ثبت‌شده توسط مریم احمدی · امروز ۱۰:۲۴</p>
        </div>
        <StatusPill status={status} />
      </div>
      <ApplicantFacts />
      <section className={styles.evidence} aria-labelledby="evidence-title">
        <h2 id="evidence-title">اطلاعات لازم برای تصمیم</h2>
        <p>
          فروشنده محصولات دست‌ساز خانگی عرضه می‌کند و سفارش‌ها را اکنون از پیام‌رسان
          پیگیری می‌کند. شماره موبایل تأیید شده است؛ مدرک اضافه در این مرحله لازم نیست.
        </p>
      </section>
      <details className={styles.auditDetails}>
        <summary>دیدن سابقه ممیزی ({events.length} رویداد)</summary>
        <AuditTrail events={events} />
      </details>
    </section>
  );
}

function QueueRail({ status }: { status: ApplicationStatus }) {
  return (
    <aside className={styles.queueRail} aria-label="صف درخواست‌ها">
      <div className={styles.queueTitle}>
        <div>
          <strong>درخواست‌های فروشندگی</strong>
          <small>۳ مورد نیازمند اقدام</small>
        </div>
      </div>
      <button type="button" className={styles.activeCase}>
        <span>خانه نارون</span>
        <small>امروز، ۱۰:۲۴</small>
        <em>{statusCopy[status].label}</em>
      </button>
      <button type="button">
        <span>روایت چوب</span>
        <small>دیروز، ۱۶:۱۰</small>
        <em>نیاز به تکمیل</em>
      </button>
      <button type="button">
        <span>مه‌بافت</span>
        <small>دیروز، ۱۲:۴۵</small>
        <em>در انتظار بررسی</em>
      </button>
    </aside>
  );
}

function VariantA({
  journey,
  status,
  events,
  reason,
  selfReview,
  onReason,
  onSelfReview,
  onDecision,
  onSubmit,
}: PrototypeContentProps) {
  if (journey === "applicant") {
    return (
      <main id="prototype-main" className={cx(styles.content, styles.applicantA)}>
        <div className={styles.pageIntro}>
          <span>فروش در سوو</span>
          <h1>درخواست فروشندگی</h1>
          <p>اطلاعات کوتاهی از کارتان می‌گیریم؛ نتیجه را همین‌جا پیگیری می‌کنید.</p>
        </div>
        <section className={styles.linearForm} aria-label="اطلاعات درخواست فروشندگی">
          <ApplicantFacts />
          <button type="button" className={styles.textButton}>
            ویرایش اطلاعات
          </button>
        </section>
        <ApplicantDecision status={status} events={events} onSubmit={onSubmit} />
      </main>
    );
  }

  return (
    <main id="prototype-main" className={cx(styles.content, styles.agentA)}>
      <QueueRail status={status} />
      <div className={styles.reviewColumn}>
        <AgentCase events={events} status={status} />
        <DecisionPanel
          status={status}
          reason={reason}
          onReason={onReason}
          selfReview={selfReview}
          onSelfReview={onSelfReview}
          onDecision={onDecision}
        />
      </div>
    </main>
  );
}

function VariantB({
  journey,
  status,
  events,
  reason,
  selfReview,
  onReason,
  onSelfReview,
  onDecision,
  onSubmit,
}: PrototypeContentProps) {
  if (journey === "applicant") {
    return (
      <main id="prototype-main" className={cx(styles.content, styles.applicantB)}>
        <div className={styles.conversationProgress}>
          <span>درخواست فروشندگی</span>
          <strong>۴ از ۴</strong>
        </div>
        <section
          className={styles.conversationCard}
          aria-labelledby="conversation-title"
        >
          <span className={styles.sevoMark} aria-hidden="true">
            س
          </span>
          <div>
            <p>خیلی خوب، این خلاصه چیزی است که برای سوو می‌فرستیم.</p>
            <h1 id="conversation-title">همه‌چیز درست است؟</h1>
          </div>
          <ApplicantFacts />
          <div className={styles.conversationActions}>
            <button type="button" className={styles.textButton}>
              یک مورد را اصلاح می‌کنم
            </button>
            <button type="button" className={styles.primaryButton} onClick={onSubmit}>
              {status === "draft" || status === "needs-info"
                ? "بله، برای بررسی بفرست"
                : "درخواست ثبت شده است"}
            </button>
          </div>
        </section>
        {status !== "draft" ? (
          <ApplicantDecision status={status} events={events} onSubmit={onSubmit} />
        ) : null}
      </main>
    );
  }

  return (
    <main id="prototype-main" className={cx(styles.content, styles.agentB)}>
      <div className={styles.singleCaseHeader}>
        <div>
          <span>مورد ۱ از ۳</span>
          <h1>آیا «خانه نارون» برای فروشندگی آماده است؟</h1>
        </div>
        <button type="button" className={styles.textButton}>
          بعداً بررسی می‌کنم
        </button>
      </div>
      <div className={styles.singleCaseBody}>
        <section className={styles.answerSheet} aria-label="پاسخ‌های متقاضی">
          <ApplicantFacts />
          <blockquote>
            «محصولات دست‌ساز خانه می‌فروشم و می‌خواهم سفارش و موجودی را از پیام‌ها جدا
            کنم.»
          </blockquote>
          <details>
            <summary>سابقه این درخواست</summary>
            <AuditTrail events={events} />
          </details>
        </section>
        <DecisionPanel
          status={status}
          reason={reason}
          onReason={onReason}
          selfReview={selfReview}
          onSelfReview={onSelfReview}
          onDecision={onDecision}
        />
      </div>
    </main>
  );
}

function VariantC({
  journey,
  status,
  events,
  reason,
  selfReview,
  onReason,
  onSelfReview,
  onDecision,
  onSubmit,
}: PrototypeContentProps) {
  if (journey === "applicant") {
    return (
      <main id="prototype-main" className={cx(styles.content, styles.applicantC)}>
        <section className={styles.caseFileHeader}>
          <div>
            <span>پرونده فروشندگی شما</span>
            <h1>خانه نارون</h1>
            <p>
              کد پیگیری <b dir="ltr">SE-1405-0824</b>
            </p>
          </div>
          <StatusPill status={status} />
        </section>
        <div className={styles.caseFileBody}>
          <section className={styles.caseSummary} aria-labelledby="case-summary-title">
            <h2 id="case-summary-title">خلاصه درخواست</h2>
            <ApplicantFacts />
            <button type="button" className={styles.textButton}>
              ویرایش پیش از تصمیم
            </button>
          </section>
          <section
            className={styles.caseTimeline}
            aria-labelledby="case-timeline-title"
          >
            <h2 id="case-timeline-title">چه اتفاقی افتاده؟</h2>
            <p>{statusCopy[status].hint}</p>
            <AuditTrail events={events} />
            {status === "draft" || status === "needs-info" ? (
              <button type="button" className={styles.primaryButton} onClick={onSubmit}>
                {status === "draft" ? "ارسال پرونده" : "ارسال اطلاعات تکمیلی"}
              </button>
            ) : null}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main id="prototype-main" className={cx(styles.content, styles.agentC)}>
      <aside className={styles.auditRail}>
        <span>پرونده SE-1405-0824</span>
        <h2>سابقه تغییرناپذیر</h2>
        <AuditTrail events={events} />
      </aside>
      <section className={styles.dossier}>
        <div className={styles.caseTitleRow}>
          <div>
            <span>بررسی درخواست فروشندگی</span>
            <h1>خانه نارون</h1>
            <p>مالک درخواست: مریم احمدی</p>
          </div>
          <StatusPill status={status} />
        </div>
        <ApplicantFacts />
        <DecisionPanel
          status={status}
          reason={reason}
          onReason={onReason}
          selfReview={selfReview}
          onSelfReview={onSelfReview}
          onDecision={onDecision}
        />
      </section>
    </main>
  );
}

type PrototypeContentProps = {
  journey: Journey;
  status: ApplicationStatus;
  events: AuditEvent[];
  reason: string;
  selfReview: boolean;
  onReason: (reason: string) => void;
  onSelfReview: (selfReview: boolean) => void;
  onDecision: (status: Exclude<ApplicationStatus, "draft" | "submitted">) => void;
  onSubmit: () => void;
};

const variants: Record<
  PrototypeVariant,
  (props: PrototypeContentProps) => React.JSX.Element
> = {
  A: VariantA,
  B: VariantB,
  C: VariantC,
};

export function SellerApplicationPrototype() {
  const variant = usePrototypeVariant();
  const [journey, setJourney] = useState<Journey>("applicant");
  const [status, setStatus] = useState<ApplicationStatus>("submitted");
  const [reason, setReason] = useState("");
  const [selfReview, setSelfReview] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>(initialAudit);

  const Variant = useMemo(() => variants[variant], [variant]);

  function submit() {
    setStatus("submitted");
    setEvents((current) => [
      ...current,
      {
        id: current.length + 1,
        title: current.some((event) => event.title.includes("تکمیل"))
          ? "اطلاعات تکمیلی فرستاده شد"
          : "درخواست ثبت شد",
        detail: "درخواست اکنون در صف بررسی عامل پلتفرم است.",
        actor: "مریم احمدی · متقاضی",
        time: "همین حالا",
      },
    ]);
  }

  function decide(nextStatus: Exclude<ApplicationStatus, "draft" | "submitted">) {
    if (selfReview || !reason.trim()) return;
    const title =
      nextStatus === "approved"
        ? "فروشندگی تأیید شد"
        : nextStatus === "rejected"
          ? "درخواست رد شد"
          : "اطلاعات تکمیلی درخواست شد";
    setStatus(nextStatus);
    setEvents((current) => [
      ...current,
      {
        id: current.length + 1,
        title,
        detail: reason.trim(),
        actor: "علی رضایی · عامل پلتفرم",
        time: "همین حالا",
      },
    ]);
    setReason("");
  }

  return (
    <div className={cx(styles.prototypePage, styles["variant" + variant])}>
      <a className={styles.skipLink} href="#prototype-main">
        رفتن به محتوای اصلی
      </a>
      <JourneyHeader journey={journey} onJourney={setJourney} status={status} />
      <Variant
        journey={journey}
        status={status}
        events={events}
        reason={reason}
        selfReview={selfReview}
        onReason={setReason}
        onSelfReview={setSelfReview}
        onDecision={decide}
        onSubmit={submit}
      />
      <div className={styles.stateReader} aria-live="polite">
        وضعیت نمونه: {statusCopy[status].label} · {events.length} رویداد ممیزی
      </div>
      <PrototypeSwitcher current={variant} />
    </div>
  );
}
