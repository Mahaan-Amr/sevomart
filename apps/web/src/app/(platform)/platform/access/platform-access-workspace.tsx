"use client";

import {
  platformAccessAuditPageContract,
  platformAccessGrantPageContract,
  platformAccessGrantContract,
  platformAccessRejectionContract,
  type PlatformAccessAuditEntry,
  type PlatformAccessGrant,
  type PlatformAccessScope,
  type Responsibility,
} from "@sevo/contracts/identity-access/v1";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type AllowedAction,
  type ScopeAction,
  sensitiveRequestDetails,
  supportsDisputeAssignment,
} from "./platform-access-request-model";
import styles from "./platform-access-workspace.module.css";

type Section = "responsibility" | "sensitive" | "emergency" | "audit";
type ResourceType = PlatformAccessScope["resourceType"];
type ReviewFinding =
  "CONTROLS_FOLLOWED" | "SCOPE_EXCEEDED" | "AUDIT_INCOMPLETE" | "FOLLOW_UP_REQUIRED";

const sections: readonly { id: Section; label: string }[] = [
  { id: "responsibility", label: "مجوزها" },
  { id: "sensitive", label: "دسترسی حساس" },
  { id: "emergency", label: "اضطراری" },
  { id: "audit", label: "سابقه" },
];

const responsibilityLabels: Record<Responsibility, string> = {
  SELLER_APPLICATION_REVIEW: "بررسی درخواست فروشندگی",
  PAYMENT_REVIEW: "بررسی پرداخت",
  ACCESS_ADMINISTRATION: "مدیریت دسترسی",
  PAYMENT_OUTCOME_CHANGE: "تغییر نتیجه پرداخت",
  SENSITIVE_IDENTITY_BANKING_BROAD_VIEW: "مشاهده گسترده هویتی و بانکی",
  HIGH_RISK_BULK_EXPORT: "خروجی انبوه پرخطر",
  ACCESS_AUDIT_REVIEW: "بازبینی سابقه دسترسی",
  DISPUTE_REVIEW: "بررسی اختلاف",
  VIOLATION_REVIEW: "بررسی تخلف",
  RELATED_BUYER_CONTEXT_REVEAL: "مشاهده زمینه مرتبط خریدار",
};

const resourceLabels: Record<ResourceType, string> = {
  SELLER_APPLICATION: "درخواست فروشندگی",
  PAYMENT_REVIEW: "بررسی پرداخت",
  ORDER: "سفارش",
  DISPUTE_CASE: "پرونده اختلاف",
  VIOLATION_CASE: "پرونده تخلف",
  IDENTITY_VERIFICATION: "احراز هویت",
};

const actionLabels: Record<AllowedAction, string> = {
  READ_MASKED: "دیدن داده پوشانده",
  REVEAL_MINIMUM: "آشکارسازی کمینه",
  ADD_CASE_NOTE: "افزودن یادداشت پرونده",
  UPDATE_CASE_STATUS: "تغییر وضعیت پرونده",
  CONTAIN_INCIDENT: "مهار حادثه",
  REVOKE_ACCESS: "لغو دسترسی",
};

const reviewFindingLabels: Record<ReviewFinding, string> = {
  CONTROLS_FOLLOWED: "کنترل‌ها رعایت شده‌اند",
  SCOPE_EXCEEDED: "دامنه دسترسی بیشتر از نیاز بوده است",
  AUDIT_INCOMPLETE: "سابقه ممیزی کامل نیست",
  FOLLOW_UP_REQUIRED: "پیگیری اصلاحی لازم است",
};

const reviewStatusLabels = {
  NOT_DUE: "پس از پایان دسترسی لازم می‌شود",
  PENDING: "در انتظار بازبینی",
  OVERDUE: "بازبینی عقب افتاده است",
  COMPLETED: "بازبینی مستقل ثبت شده است",
  COMPLETED_WITHOUT_INDEPENDENT_REVIEW:
    "بدون بازبینی مستقل ثبت شده؛ جایگزینی مستقل لازم است",
} as const;

const statusLabels: Record<PlatformAccessGrant["status"], string> = {
  PENDING_APPROVAL: "در انتظار اقدام",
  ACTIVE: "فعال",
  EXPIRED: "منقضی",
  REVOKED: "لغوشده",
  CLOSED: "بسته‌شده",
};

const auditActionLabels: Record<PlatformAccessAuditEntry["action"], string> = {
  GRANT_REQUESTED: "درخواست ثبت شد",
  GRANT_APPROVED: "درخواست تأیید شد",
  GRANT_ACTIVATED: "دسترسی فعال شد",
  GRANT_REJECTED: "درخواست رد شد",
  GRANT_REVOKED: "دسترسی لغو شد",
  GRANT_EXPIRED: "مهلت پایان یافت",
  EMERGENCY_ACCESS_CLOSED: "دسترسی اضطراری بسته شد",
  SENSITIVE_FIELD_REVEALED: "داده کمینه آشکار شد",
  SENSITIVE_CHANGE_ATTEMPTED: "تغییر حساس بررسی شد",
  POST_INCIDENT_REVIEW_COMPLETED: "بازبینی پس از حادثه ثبت شد",
};

const responsibilities = Object.keys(responsibilityLabels) as Responsibility[];
const resourceTypes = Object.keys(resourceLabels) as ResourceType[];
const allowedActions = Object.keys(actionLabels) as AllowedAction[];
const disputeAssignmentAction = "REVIEW_AND_RESOLVE_DISPUTE" as const;

export function PlatformAccessWorkspace({
  actorIdentityId,
  canAdminister,
  canReviewAudit,
}: {
  actorIdentityId: string;
  canAdminister: boolean;
  canReviewAudit: boolean;
}) {
  const availableSections = useMemo(
    () =>
      sections.filter(({ id }) => (id === "audit" ? canReviewAudit : canAdminister)),
    [canAdminister, canReviewAudit],
  );
  const [section, setSection] = useState<Section>(
    canAdminister ? "responsibility" : "audit",
  );
  const [grants, setGrants] = useState<PlatformAccessGrant[]>([]);
  const [audit, setAudit] = useState<PlatformAccessAuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const tabRefs = useRef(new Map<Section, HTMLButtonElement>());

  const selected = useMemo(
    () => grants.find((grant) => grant.grantId === selectedId) ?? grants[0],
    [grants, selectedId],
  );

  const readSection = useCallback(
    async (
      nextSection: Section,
      preferredId?: string,
      clearMessage = true,
      cursor?: string,
    ): Promise<boolean> => {
      setLoading(true);
      if (clearMessage) setMessage("");
      try {
        const path =
          nextSection === "audit"
            ? `/api/platform/access/audit?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
            : `/api/platform/access/${sectionPath(nextSection)}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const response = await fetch(path, { cache: "no-store" });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(humanError(body));
        if (nextSection === "audit") {
          const page = platformAccessAuditPageContract.parse(body);
          setAudit((current) => (cursor ? [...current, ...page.items] : page.items));
          setNextCursor(page.nextCursor);
        } else {
          const page = platformAccessGrantPageContract.parse(body);
          setGrants((current) => (cursor ? [...current, ...page.items] : page.items));
          setNextCursor(page.nextCursor);
          setSelectedId((current) =>
            preferredId && page.items.some((item) => item.grantId === preferredId)
              ? preferredId
              : page.items.some((item) => item.grantId === current)
                ? current
                : page.items[0]?.grantId,
          );
        }
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "فهرست در دسترس نیست.");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void readSection(section);
  }, [readSection, section]);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const last = availableSections.length - 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowLeft"
            ? (index + 1) % availableSections.length
            : (index - 1 + availableSections.length) % availableSections.length;
    const next = availableSections[nextIndex];
    if (!next) return;
    setSection(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  async function mutate(path: string, payload: unknown, successMessage: string) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/platform/access/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(humanError(body));
      const preferredId = path.endsWith("/rejection")
        ? platformAccessRejectionContract.parse(body).grantId
        : platformAccessGrantContract.parse(body).grantId;
      const refreshed = await readSection(section, preferredId, false);
      setMessage(
        refreshed
          ? successMessage
          : `${successMessage} تازه‌سازی صف انجام نشد؛ صفحه را دوباره بارگذاری کنید.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "اقدام ثبت نشد.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="access-title">
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>سوو · اعتماد و دسترسی</span>
            <h1 id="access-title">مدیریت دسترسی پلتفرم</h1>
          </div>
          <p>هر اختیار محدود، قابل لغو و قابل پیگیری است.</p>
        </header>

        <div className={styles.tabs} role="tablist" aria-label="بخش‌های دسترسی">
          {availableSections.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                if (node) tabRefs.current.set(item.id, node);
                else tabRefs.current.delete(item.id);
              }}
              type="button"
              role="tab"
              aria-selected={section === item.id}
              aria-controls={`access-panel-${item.id}`}
              id={`access-tab-${item.id}`}
              tabIndex={section === item.id ? 0 : -1}
              onClick={() => setSection(item.id)}
              onKeyDown={(event) => moveTab(event, index)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {message ? (
          <p className={styles.message} role="status" aria-live="polite">
            {message}
          </p>
        ) : null}

        {availableSections.map((item) => {
          const active = section === item.id;
          return (
            <div
              key={item.id}
              id={`access-panel-${item.id}`}
              role="tabpanel"
              aria-labelledby={`access-tab-${item.id}`}
              tabIndex={active ? 0 : -1}
              hidden={!active}
            >
              {active ? (
                item.id === "audit" ? (
                  <AuditHistory entries={audit} loading={loading} />
                ) : (
                  <>
                    <CreateRequest
                      key={item.id}
                      section={item.id}
                      pending={pending}
                      mutate={mutate}
                    />
                    <div className={styles.split} aria-busy={loading}>
                      <GrantQueue
                        grants={grants}
                        selectedId={selected?.grantId}
                        onSelect={setSelectedId}
                      />
                      <GrantDetails
                        actorIdentityId={actorIdentityId}
                        canReviewAudit={canReviewAudit}
                        grant={selected}
                        pending={pending}
                        mutate={mutate}
                      />
                    </div>
                  </>
                )
              ) : null}
              {active && nextCursor ? (
                <button
                  className={styles.loadMore}
                  type="button"
                  disabled={loading}
                  onClick={() => void readSection(section, undefined, true, nextCursor)}
                >
                  نمایش موارد بیشتر
                </button>
              ) : null}
            </div>
          );
        })}
      </section>
    </main>
  );
}

function CreateRequest({
  section,
  pending,
  mutate,
}: {
  section: Exclude<Section, "audit">;
  pending: boolean;
  mutate: (path: string, payload: unknown, successMessage: string) => Promise<void>;
}) {
  const [recipient, setRecipient] = useState("");
  const [responsibility, setResponsibility] =
    useState<Responsibility>("PAYMENT_REVIEW");
  const [resourceType, setResourceType] = useState<ResourceType>("PAYMENT_REVIEW");
  const [resourceId, setResourceId] = useState("");
  const [incidentId, setIncidentId] = useState("");
  const [reason, setReason] = useState("");
  const [ttlMinutes, setTtlMinutes] = useState(30);
  const [action, setAction] = useState<ScopeAction>("READ_MASKED");
  const [showScope, setShowScope] = useState(false);
  const [showJustification, setShowJustification] = useState(false);

  useEffect(() => {
    setShowScope(false);
    setShowJustification(false);
  }, [section]);

  useEffect(() => {
    if (
      action === disputeAssignmentAction &&
      !supportsDisputeAssignment(responsibility, resourceType)
    ) {
      setAction("READ_MASKED");
    }
  }, [action, resourceType, responsibility]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 10) return;
    if (section === "responsibility") {
      await mutate(
        "responsibility-grants",
        { recipientIdentityId: recipient, responsibility, reason },
        "درخواست مجوز ثبت شد؛ وضعیت و قدم بعدی در صف دیده می‌شود.",
      );
    } else if (section === "sensitive") {
      const request = sensitiveRequestDetails({
        responsibility,
        resourceType,
        action,
      });
      await mutate(
        "sensitive-grants",
        {
          ...(recipient ? { recipientIdentityId: recipient } : {}),
          responsibility,
          purposeCode: request.purposeCode,
          reason,
          scope: { resourceType, resourceId, allowedActions: request.allowedActions },
          ttlMinutes,
        },
        "درخواست دسترسی حساس ثبت شد؛ داده تا اقدام صریح پوشانده می‌ماند.",
      );
    } else {
      await mutate(
        "emergency-grants",
        {
          incidentId,
          reason,
          scope: { resourceType, resourceId, allowedActions: [action] },
          ttlMinutes,
        },
        "درخواست اضطراری ثبت شد؛ پیش از استفاده باید فعال شود.",
      );
    }
    setReason("");
  }

  return (
    <details className={styles.create}>
      <summary>{createLabel(section)}</summary>
      <form onSubmit={(event) => void submit(event)}>
        {section !== "emergency" ? (
          <label>
            شناسه هویت دریافت‌کننده {section === "sensitive" ? "(اختیاری)" : ""}
            <input
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              required={section === "responsibility"}
              dir="ltr"
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
        ) : (
          <label>
            شناسه حادثه
            <input
              value={incidentId}
              onChange={(event) => setIncidentId(event.target.value)}
              required
              dir="ltr"
              placeholder="INC-..."
            />
          </label>
        )}
        {section !== "emergency" ? (
          <label>
            مسئولیت
            <select
              value={responsibility}
              onChange={(event) =>
                setResponsibility(event.target.value as Responsibility)
              }
            >
              {responsibilities.map((value) => (
                <option key={value} value={value}>
                  {responsibilityLabels[value]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {section !== "responsibility" && !showScope ? (
          <button
            className={styles.primary}
            type="button"
            onClick={() => setShowScope(true)}
          >
            ادامه: تعیین دامنه دسترسی
          </button>
        ) : null}
        {section !== "responsibility" && showScope && !showJustification ? (
          <>
            <label>
              نوع پرونده
              <select
                value={resourceType}
                onChange={(event) =>
                  setResourceType(event.target.value as ResourceType)
                }
              >
                {resourceTypes.map((value) => (
                  <option key={value} value={value}>
                    {resourceLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              شناسه پرونده
              <input
                value={resourceId}
                onChange={(event) => setResourceId(event.target.value)}
                required
                dir="ltr"
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </label>
            <label>
              اقدام لازم
              <select
                value={action}
                onChange={(event) => setAction(event.target.value as ScopeAction)}
              >
                {allowedActions.map((value) => (
                  <option key={value} value={value}>
                    {actionLabels[value]}
                  </option>
                ))}
                {section === "sensitive" &&
                supportsDisputeAssignment(responsibility, resourceType) ? (
                  <option value={disputeAssignmentAction}>
                    مشاهده و ثبت نتیجه اختلاف
                  </option>
                ) : null}
              </select>
            </label>
            <label>
              مهلت (دقیقه)
              <input
                type="number"
                min="1"
                max={section === "emergency" ? 30 : 60}
                value={ttlMinutes}
                onChange={(event) => setTtlMinutes(Number(event.target.value))}
              />
            </label>
          </>
        ) : null}
        {(section === "responsibility" || showScope) && !showJustification ? (
          <button
            className={styles.primary}
            type="button"
            onClick={() => setShowJustification(true)}
          >
            ادامه: ثبت دلیل و تأیید
          </button>
        ) : null}
        {showJustification ? (
          <>
            <div className={styles.stepSummary}>
              <p>
                {section === "responsibility"
                  ? responsibilityLabels[responsibility]
                  : `${resourceLabels[resourceType]} · ${scopeActionLabel(action)} · ${ttlMinutes} دقیقه`}
              </p>
              <button
                type="button"
                onClick={() => {
                  setShowJustification(false);
                  if (section !== "responsibility") setShowScope(true);
                }}
              >
                بازگشت و اصلاح
              </button>
            </div>
            <label className={styles.wide}>
              دلیل داخلی بدون اطلاعات شخصی یا بانکی
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={10}
                maxLength={1000}
                required
              />
            </label>
            <button className={styles.primary} type="submit" disabled={pending}>
              {pending ? "در حال ثبت…" : createLabel(section)}
            </button>
          </>
        ) : null}
      </form>
    </details>
  );
}

function scopeActionLabel(action: ScopeAction) {
  return action === disputeAssignmentAction
    ? "مشاهده و ثبت نتیجه اختلاف"
    : actionLabels[action];
}

function GrantQueue({
  grants,
  selectedId,
  onSelect,
}: {
  grants: PlatformAccessGrant[];
  selectedId?: string;
  onSelect: (grantId: string) => void;
}) {
  return (
    <aside className={styles.queue} aria-label="صف دسترسی‌ها">
      {grants.length === 0 ? (
        <p className={styles.empty}>موردی در این صف نیست.</p>
      ) : (
        grants.map((grant) => (
          <button
            type="button"
            key={grant.grantId}
            aria-pressed={selectedId === grant.grantId}
            onClick={() => onSelect(grant.grantId)}
          >
            <strong>{grantTitle(grant)}</strong>
            <span>{statusLabels[grant.status]}</span>
            <small>{shortId(grant.subjectIdentityId)}</small>
          </button>
        ))
      )}
    </aside>
  );
}

function GrantDetails({
  actorIdentityId,
  canReviewAudit,
  grant,
  pending,
  mutate,
}: {
  actorIdentityId: string;
  canReviewAudit: boolean;
  grant?: PlatformAccessGrant;
  pending: boolean;
  mutate: (path: string, payload: unknown, successMessage: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [reviewFinding, setReviewFinding] =
    useState<ReviewFinding>("CONTROLS_FOLLOWED");
  if (!grant) {
    return (
      <section className={styles.details}>
        برای دیدن جزئیات، یک مورد را انتخاب کنید.
      </section>
    );
  }
  const basePath = `${sectionPathForGrant(grant)}/${grant.grantId}`;
  const canApprove =
    grant.status === "PENDING_APPROVAL" &&
    !grant.singleManagerException &&
    grant.approvedByIdentityId === null &&
    actorIdentityId !== grant.requestedByIdentityId &&
    actorIdentityId !== grant.subjectIdentityId;
  const canActivateEmergency =
    grant.grantKind === "EMERGENCY_ACCESS" &&
    grant.status === "PENDING_APPROVAL" &&
    actorIdentityId === grant.requestedByIdentityId &&
    (grant.singleManagerException || grant.approvedByIdentityId !== null);
  const canRevoke = grant.status === "PENDING_APPROVAL" || grant.status === "ACTIVE";
  const canReject = canApprove;
  const canReview =
    canReviewAudit &&
    grant.grantKind === "EMERGENCY_ACCESS" &&
    ["EXPIRED", "REVOKED", "CLOSED"].includes(grant.status) &&
    grant.reviewEligibility !== undefined &&
    grant.reviewEligibility !== "NOT_ELIGIBLE";

  return (
    <section className={styles.details} aria-labelledby="grant-detail-title">
      <div className={styles.detailHeading}>
        <div>
          <span>{grantKindLabel(grant)}</span>
          <h2 id="grant-detail-title">{grantTitle(grant)}</h2>
        </div>
        <strong>{statusLabels[grant.status]}</strong>
      </div>
      <p className={styles.nextStep}>{nextStep(grant)}</p>
      {grant.singleManagerException ? (
        <p className={styles.warning}>این مورد با استثنای تک‌مدیر ثبت شده است.</p>
      ) : null}
      <dl>
        <Fact label="دریافت‌کننده" value={shortId(grant.subjectIdentityId)} />
        <Fact label="درخواست‌کننده" value={shortId(grant.requestedByIdentityId)} />
        <Fact label="نسخه" value={String(grant.revision)} />
        {grant.grantKind !== "RESPONSIBILITY" ? (
          <>
            <Fact label="پرونده" value={resourceLabels[grant.scope.resourceType]} />
            <Fact label="شناسه پرونده" value={shortId(grant.scope.resourceId)} />
            <Fact
              label="اقدام‌ها"
              value={grant.scope.allowedActions
                .map((item) => actionLabels[item])
                .join("، ")}
            />
            <Fact label="پایان مهلت" value={formatDate(grant.expiresAt)} />
            {grant.grantKind === "EMERGENCY_ACCESS" ? (
              <>
                <Fact label="مهلت بازبینی" value={formatDate(grant.reviewDueAt)} />
                <Fact
                  label="وضعیت بازبینی"
                  value={reviewStatusLabels[grant.reviewStatus]}
                />
              </>
            ) : null}
          </>
        ) : null}
      </dl>
      <p className={styles.privacyNote}>
        این صفحه داده شخصی یا بانکی را نشان نمی‌دهد. آشکارسازی فقط در همان پرونده، با
        اقدام صریح و ثبت در سابقه انجام می‌شود.
      </p>
      <div className={styles.actions}>
        {canApprove ? (
          <button
            className={styles.primary}
            type="button"
            disabled={pending}
            onClick={() =>
              void mutate(
                `${basePath}/approval`,
                { expectedRevision: grant.revision },
                "تأیید ثبت شد؛ وضعیت تازه نمایش داده می‌شود.",
              )
            }
          >
            تأیید مستقل
          </button>
        ) : null}
        {canReject ? (
          <button
            type="button"
            disabled={pending || reason.trim().length < 10}
            onClick={() =>
              void mutate(
                `${basePath}/rejection`,
                { expectedRevision: grant.revision, reason },
                "درخواست رد شد و از صف اقدام خارج شد.",
              )
            }
          >
            رد درخواست
          </button>
        ) : null}
        {canActivateEmergency ? (
          <button
            className={styles.primary}
            type="button"
            disabled={pending}
            onClick={() =>
              void mutate(
                `${basePath}/activation`,
                { expectedRevision: grant.revision },
                "دسترسی اضطراری فعال شد؛ پایان مهلت تغییر نمی‌کند.",
              )
            }
          >
            فعال‌کردن اضطراری
          </button>
        ) : null}
        {grant.grantKind === "EMERGENCY_ACCESS" && grant.status === "ACTIVE" ? (
          <button
            type="button"
            disabled={pending || reason.trim().length < 10}
            onClick={() =>
              void mutate(
                `${basePath}/closure`,
                { expectedRevision: grant.revision, reason },
                "دسترسی اضطراری بسته شد؛ بازبینی پس از حادثه باقی می‌ماند.",
              )
            }
          >
            بستن پس از مهار
          </button>
        ) : null}
        {canRevoke ? (
          <button
            type="button"
            disabled={pending || reason.trim().length < 10}
            onClick={() =>
              void mutate(
                `${basePath}/revocation`,
                { expectedRevision: grant.revision, reason },
                "لغو ثبت شد و از درخواست بعدی مؤثر است.",
              )
            }
          >
            لغو دسترسی
          </button>
        ) : null}
        {canReview ? (
          <>
            <label className={styles.reviewFinding}>
              نتیجه بازبینی
              <select
                value={reviewFinding}
                onChange={(event) =>
                  setReviewFinding(event.target.value as ReviewFinding)
                }
              >
                {Object.entries(reviewFindingLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={styles.primary}
              type="button"
              disabled={pending}
              onClick={() =>
                void mutate(
                  `${basePath}/review`,
                  { expectedRevision: grant.revision, findingCode: reviewFinding },
                  "بازبینی پس از حادثه ثبت شد.",
                )
              }
            >
              ثبت بازبینی پس از حادثه
            </button>
          </>
        ) : null}
      </div>
      {canRevoke ||
      canReject ||
      (grant.grantKind === "EMERGENCY_ACCESS" && grant.status === "ACTIVE") ? (
        <label className={styles.reason}>
          دلیل اقدام بدون اطلاعات شخصی یا بانکی
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={10}
            maxLength={1000}
          />
        </label>
      ) : null}
    </section>
  );
}

function AuditHistory({
  entries,
  loading,
}: {
  entries: PlatformAccessAuditEntry[];
  loading: boolean;
}) {
  return (
    <section className={styles.audit} aria-busy={loading} aria-labelledby="audit-title">
      <div>
        <h2 id="audit-title">سابقه تغییرناپذیر دسترسی</h2>
        <p>مقدار داده حساس در این سابقه تکرار نمی‌شود.</p>
      </div>
      {entries.length === 0 ? (
        <p className={styles.empty}>رویدادی برای نمایش نیست.</p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.auditId}>
              <div>
                <strong>{auditActionLabels[entry.action]}</strong>
                <span>{formatDate(entry.occurredAt)}</span>
              </div>
              <p>{entry.reason}</p>
              <small>
                دسترسی {shortId(entry.grantId)} · عامل {shortId(entry.actorIdentityId)}
              </small>
            </li>
          ))}
        </ol>
      )}
    </section>
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

function sectionPath(section: Exclude<Section, "audit">) {
  return section === "responsibility"
    ? "responsibility-grants"
    : section === "sensitive"
      ? "sensitive-grants"
      : "emergency-grants";
}

function sectionPathForGrant(grant: PlatformAccessGrant) {
  return grant.grantKind === "RESPONSIBILITY"
    ? "responsibility-grants"
    : grant.grantKind === "SENSITIVE_ACCESS"
      ? "sensitive-grants"
      : "emergency-grants";
}

function createLabel(section: Exclude<Section, "audit">) {
  return section === "responsibility"
    ? "واگذاری مسئولیت"
    : section === "sensitive"
      ? "درخواست دسترسی حساس"
      : "درخواست دسترسی اضطراری";
}

function grantTitle(grant: PlatformAccessGrant) {
  if (grant.grantKind === "RESPONSIBILITY") {
    return responsibilityLabels[grant.responsibility];
  }
  if (grant.grantKind === "SENSITIVE_ACCESS") {
    return `${responsibilityLabels[grant.responsibility]} · ${resourceLabels[grant.scope.resourceType]}`;
  }
  return `حادثه ${grant.incidentId}`;
}

function grantKindLabel(grant: PlatformAccessGrant) {
  return grant.grantKind === "RESPONSIBILITY"
    ? "مجوز مسئولیت"
    : grant.grantKind === "SENSITIVE_ACCESS"
      ? "اجازه دسترسی حساس"
      : "دسترسی اضطراری";
}

function nextStep(grant: PlatformAccessGrant) {
  if (grant.status === "ACTIVE") {
    return grant.grantKind === "EMERGENCY_ACCESS"
      ? "حادثه را مهار کنید؛ سپس دسترسی را ببندید یا فوراً لغو کنید."
      : "دسترسی زنده است؛ با پایان نیاز عملیاتی آن را لغو کنید.";
  }
  if (grant.status === "PENDING_APPROVAL") {
    if (grant.grantKind === "EMERGENCY_ACCESS" && grant.singleManagerException) {
      return "استثنای تک‌مدیر ثبت شده است؛ اکنون دسترسی اضطراری را فعال کنید.";
    }
    if (grant.grantKind === "EMERGENCY_ACCESS" && grant.approvedByIdentityId) {
      return "تأیید مستقل ثبت شده است؛ درخواست‌کننده باید دسترسی را فعال کند.";
    }
    return "این درخواست منتظر تأیید یک مدیر دسترسی مستقل است.";
  }
  if (
    grant.grantKind === "EMERGENCY_ACCESS" &&
    ["EXPIRED", "REVOKED", "CLOSED"].includes(grant.status)
  ) {
    if (grant.reviewStatus === "COMPLETED") {
      return "دسترسی پایان یافته و بازبینی مستقل آن ثبت شده است.";
    }
    if (grant.reviewStatus === "COMPLETED_WITHOUT_INDEPENDENT_REVIEW") {
      return grant.reviewEligibility === "INDEPENDENT"
        ? "بازبینی تک‌انسانی ثبت شده است؛ اکنون آن را مستقل بازبینی کنید."
        : "بازبینی تک‌انسانی ثبت شده است؛ بازبین مستقل باید آن را جایگزین کند.";
    }
    if (grant.reviewEligibility === "WITHOUT_INDEPENDENT_REVIEW") {
      return "فقط یک انسان فعال است؛ نتیجه را با نشان «بدون بازبینی مستقل» ثبت کنید.";
    }
    if (grant.reviewEligibility === "INDEPENDENT") {
      return "دسترسی پایان یافته است؛ نتیجه بازبینی مستقل را اکنون ثبت کنید.";
    }
    return grant.reviewStatus === "OVERDUE"
      ? "بازبینی عقب افتاده و درخواست تازه را مسدود کرده است؛ بازبین مستقل باید اقدام کند."
      : "دسترسی پایان یافته است؛ بازبین مستقل باید تا مهلت نمایش‌داده‌شده اقدام کند.";
  }
  if (grant.status === "EXPIRED")
    return "مهلت پایان یافته است؛ ادامه کار درخواست تازه می‌خواهد.";
  if (grant.status === "REVOKED")
    return "دسترسی لغو شده و از درخواست بعدی قابل استفاده نیست.";
  return "دسترسی بسته شده است؛ بازبینی پس از حادثه را پیگیری کنید.";
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}

function humanError(body: unknown) {
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return body.message;
  }
  return "درخواست انجام نشد؛ دوباره تلاش کنید.";
}
