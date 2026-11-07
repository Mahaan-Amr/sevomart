"use client";
import { useCallback, useEffect, useState } from "react";
import styles from "./superadmins.module.css";

type Role = { identityId: string; status: "ACTIVE" | "INACTIVE" | "REVOKED" };
type Audit = {
  actorIdentityId: string | null;
  subjectIdentityId: string;
  action: string;
  reason: string;
  occurredAt: string;
};
type SensitiveAudit = {
  actorIdentityId: string;
  resourceType: string;
  resourceId: string;
  action: string;
  reason: string;
  outcome: string;
  occurredAt: string;
};
export function Superadmins() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [sensitiveAudit, setSensitiveAudit] = useState<SensitiveAudit[]>([]);
  const [identityId, setIdentityId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    const [roleResponse, auditResponse, sensitiveResponse] = await Promise.all([
      fetch("/api/platform/access/superadmins"),
      fetch("/api/platform/access/superadmins/audit"),
      fetch("/api/platform/access/superadmins/sensitive-audit"),
    ]);
    if (!roleResponse.ok || !auditResponse.ok || !sensitiveResponse.ok)
      throw new Error("load");
    setRoles((await roleResponse.json()).items);
    setAudit((await auditResponse.json()).items);
    setSensitiveAudit((await sensitiveResponse.json()).items);
  }, []);
  useEffect(() => {
    void load().catch(() => setMessage("دریافت دسترسی‌ها ممکن نشد؛ دوباره تلاش کنید."));
  }, [load]);
  async function change(target: string, revoke: boolean) {
    if (reason.trim().length < 10) {
      setMessage("دلیل اقدام را کامل بنویسید.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/platform/access/superadmins${revoke ? `/${encodeURIComponent(target)}/revocation` : ""}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify(revoke ? { reason } : { identityId: target, reason }),
        },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        setMessage(
          error.code === "LAST_SUPERADMIN"
            ? "لغو آخرین سوپرادمین فعال ممکن نیست."
            : "ثبت اقدام ممکن نشد؛ شناسه، دلیل و وضعیت ورود را بررسی کنید.",
        );
        return;
      }
      await load();
      setMessage(revoke ? "دسترسی لغو شد." : "دسترسی ثبت شد.");
    } catch {
      setMessage("ارتباط برقرار نشد؛ دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }
  return (
    <main className={styles.page} dir="rtl">
      <h1>مدیریت سوپرادمین‌ها</h1>
      <p>اعطا و لغو دسترسی همراه با دلیل ثبت می‌شود.</p>
      <label>
        شناسه هویت
        <input
          value={identityId}
          onChange={(event) => setIdentityId(event.target.value)}
          dir="ltr"
        />
      </label>
      <label>
        دلیل اقدام
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => void change(identityId, false)}
      >
        اعطای دسترسی
      </button>
      {message && <p role="status">{message}</p>}
      <h2>دسترسی‌ها</h2>
      <ul>
        {roles.map((role) => (
          <li key={role.identityId}>
            <span dir="ltr">{role.identityId}</span>
            <span>
              {role.status === "ACTIVE"
                ? "فعال"
                : role.status === "INACTIVE"
                  ? "هویت غیرفعال"
                  : "لغوشده"}
            </span>
            {role.status !== "REVOKED" && (
              <button
                type="button"
                disabled={pending}
                aria-label={`لغو دسترسی ${role.identityId}`}
                onClick={() => void change(role.identityId, true)}
              >
                لغو دسترسی
              </button>
            )}
          </li>
        ))}
      </ul>
      <h2>سابقه اقدام‌ها</h2>
      <ul>
        {audit.map((entry, index) => (
          <li key={`${entry.occurredAt}-${index}`}>
            <span>
              {entry.action === "GRANTED"
                ? "اعطا"
                : entry.action === "REVOKED"
                  ? "لغو"
                  : entry.action === "TOTP_ENROLLMENT_AUTHORIZED"
                    ? "اجازه ثبت تأیید دوم"
                    : "بازیابی"}
            </span>
            <span dir="ltr">{entry.subjectIdentityId}</span>
            <span dir="ltr">{entry.actorIdentityId ?? "بازیابی مالک"}</span>
            <span>{entry.reason}</span>
            <time>
              {new Intl.DateTimeFormat("fa-IR", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(entry.occurredAt))}
            </time>
          </li>
        ))}
      </ul>
      <h2>سابقه دسترسی حساس</h2>
      <ul>
        {sensitiveAudit.map((entry, index) => (
          <li key={`${entry.occurredAt}-${index}`}>
            <span>{entry.outcome === "ALLOWED" ? "انجام شد" : "رد شد"}</span>
            <span dir="ltr">{entry.actorIdentityId}</span>
            <span>
              {caseLabel(entry.resourceType)} · {actionLabel(entry.action)}
            </span>
            <span dir="ltr">{entry.resourceId}</span>
            <span>{entry.reason}</span>
            <time>
              {new Intl.DateTimeFormat("fa-IR", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(entry.occurredAt))}
            </time>
          </li>
        ))}
      </ul>
    </main>
  );
}

function caseLabel(type: string) {
  const labels: Record<string, string> = {
    PAYMENT_REVIEW: "پرداخت",
    DISPUTE_CASE: "اختلاف",
    VIOLATION_CASE: "تخلف",
    SELLER_APPLICATION: "درخواست فروشندگی",
    ORDER: "سفارش",
    IDENTITY_VERIFICATION: "هویت",
  };
  return labels[type] ?? "پرونده";
}
function actionLabel(action: string) {
  const labels: Record<string, string> = {
    READ_MASKED: "مشاهده محدود",
    REVEAL_MINIMUM: "مشاهده جزئیات",
    ADD_CASE_NOTE: "ثبت یادداشت",
    UPDATE_CASE_STATUS: "تغییر وضعیت",
    CONTAIN_INCIDENT: "مهار مشکل",
    REVOKE_ACCESS: "لغو دسترسی",
  };
  return labels[action] ?? "اقدام";
}
