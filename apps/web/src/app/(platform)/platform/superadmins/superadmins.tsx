"use client";
import { useCallback, useEffect, useState } from "react";
import styles from "./superadmins.module.css";

type Role = { identityId: string; status: "ACTIVE" | "REVOKED" };
type Audit = {
  actorIdentityId: string | null;
  subjectIdentityId: string;
  action: string;
  reason: string;
  occurredAt: string;
};
export function Superadmins() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [identityId, setIdentityId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    const [roleResponse, auditResponse] = await Promise.all([
      fetch("/api/platform/access/superadmins"),
      fetch("/api/platform/access/superadmins/audit"),
    ]);
    if (!roleResponse.ok || !auditResponse.ok) throw new Error("load");
    setRoles((await roleResponse.json()).items);
    setAudit((await auditResponse.json()).items);
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
            <span>{role.status === "ACTIVE" ? "فعال" : "لغوشده"}</span>
            {role.status === "ACTIVE" && (
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
                  : "بازیابی"}
            </span>
            <span dir="ltr">{entry.subjectIdentityId}</span>
            <span>{entry.reason}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
