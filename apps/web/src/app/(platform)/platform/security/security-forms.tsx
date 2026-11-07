"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import styles from "./security.module.css";

type Recovery = {
  recoveryId: string;
  targetIdentityId: string;
  incidentId: string;
  reason: string;
  status: string;
  approvalCount: number;
};
async function call(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/platform/security/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      response.status === 422
        ? "اطلاعات را بررسی کنید."
        : response.status === 503
          ? "این خدمت اکنون در دسترس نیست."
          : "اجازه یا تأیید تازه برای این کار معتبر نیست. دوباره وارد شوید و وضعیت را بررسی کنید.",
    );
  return response.status === 204
    ? {}
    : ((await response.json()) as Record<string, unknown>);
}
function Code({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      کد برنامه تأیید
      <input
        dir="ltr"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value.replace(/[۰-۹٠-٩]/g, (digit) =>
              String(digit.charCodeAt(0) - (digit >= "۰" ? 0x06f0 : 0x0660)),
            ),
          )
        }
      />
    </label>
  );
}
function Links({ canAdmin }: { canAdmin: boolean }) {
  return (
    <nav className={styles.links} aria-label="امنیت ورود">
      <Link href="/platform/security/authenticator">ثبت برنامه</Link>
      <Link href="/platform/security/recovery">بازیابی برنامه</Link>
      {canAdmin && <Link href="/platform/security/approvals">تأیید بازیابی</Link>}
    </nav>
  );
}
export function Authenticator({ canAdmin }: { canAdmin: boolean }) {
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function begin() {
    setBusy(true);
    setMessage("");
    try {
      const result = await call("enrollment");
      setSecret(String(result.secret));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await call("enrollment/confirmation", { code });
      setSecret("");
      setCode("");
      setMessage("برنامه تأیید فعال شد.");
    } catch (error) {
      setCode("");
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.page}>
      <h1>ثبت برنامه تأیید</h1>
      <p>
        پس از ورود تازه، کلید را در برنامه تأیید خود وارد کنید و کد نمایش‌داده‌شده را
        بنویسید. کلید فقط یک بار نشان داده می‌شود.
      </p>
      <Links canAdmin={canAdmin} />
      {!secret ? (
        <button type="button" disabled={busy} onClick={begin}>
          شروع ثبت برنامه
        </button>
      ) : (
        <form onSubmit={confirm}>
          <span>کلید برنامه تأیید</span>
          <code className={styles.secret}>{secret}</code>
          <Code value={code} onChange={setCode} />
          <button disabled={busy}>تأیید و فعال‌کردن</button>
        </form>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
    </main>
  );
}
export function RecoveryFlow({ canAdmin }: { canAdmin: boolean }) {
  const [incidentId, setIncidentId] = useState("");
  const [reason, setReason] = useState("");
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function request(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const data = await call("recoveries", { incidentId, reason });
      setId(String(data.recoveryId));
      setMessage(
        "شناسه درخواست را به دو مدیر مستقل بدهید. پس از تأیید هر دو، اینجا ادامه دهید.",
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function begin() {
    setBusy(true);
    setMessage("");
    try {
      const data = await call(`recoveries/${encodeURIComponent(id)}/enrollment`);
      setSecret(String(data.secret));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await call(`recoveries/${encodeURIComponent(id)}/confirmation`, { code });
      setSecret("");
      setCode("");
      setMessage("برنامه تازه فعال شد.");
    } catch (error) {
      setCode("");
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.page}>
      <h1>بازیابی برنامه تأیید</h1>
      <p>برای بازیابی، دو مدیر مستقل هویت شما را بررسی و درخواست را تأیید می‌کنند.</p>
      <Links canAdmin={canAdmin} />
      <form onSubmit={request}>
        <label>
          شناسه پیگیری
          <input
            required
            minLength={3}
            maxLength={100}
            value={incidentId}
            onChange={(event) => setIncidentId(event.target.value)}
          />
        </label>
        <label>
          دلیل درخواست
          <textarea
            required
            minLength={5}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <button disabled={busy}>ثبت درخواست</button>
      </form>
      <div className={styles.stack}>
        <label>
          شناسه درخواست
          <input dir="ltr" value={id} onChange={(event) => setId(event.target.value)} />
        </label>
        {!secret && (
          <button type="button" disabled={busy || !id} onClick={begin}>
            ادامه پس از تأیید دو مدیر
          </button>
        )}
      </div>
      {secret && (
        <form onSubmit={confirm}>
          <span>کلید برنامه تازه</span>
          <code className={styles.secret}>{secret}</code>
          <Code value={code} onChange={setCode} />
          <button disabled={busy}>تأیید برنامه تازه</button>
        </form>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
    </main>
  );
}
export function RecoveryApproval() {
  const [id, setId] = useState("");
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function read(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setRecovery(null);
    try {
      setRecovery(
        (await call(
          `recoveries/${encodeURIComponent(id)}`,
          undefined,
          "GET",
        )) as Recovery,
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function approve(event: FormEvent) {
    event.preventDefault();
    if (!recovery) return;
    setBusy(true);
    setMessage("");
    try {
      const proof = await call("proofs", {
        action: "APPROVE_TOTP_RECOVERY",
        code,
        targetIdentityId: recovery.targetIdentityId,
        incidentId: recovery.recoveryId,
        reason: recovery.reason,
      });
      setCode("");
      await call(`recoveries/${encodeURIComponent(id)}/approvals`, {
        proof: proof.proof,
      });
      setMessage("تأیید شما ثبت شد.");
      setRecovery(null);
    } catch (error) {
      setCode("");
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.page}>
      <h1>تأیید بازیابی</h1>
      <p>
        ابتدا هویت درخواست‌کننده را از مسیر مستقل بررسی کنید. تأیید درخواست خودتان ممکن
        نیست.
      </p>
      <Links canAdmin />
      <form onSubmit={read}>
        <label>
          شناسه درخواست
          <input
            dir="ltr"
            required
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
        </label>
        <button disabled={busy}>دیدن درخواست</button>
      </form>
      {recovery && (
        <form onSubmit={approve}>
          <p>
            هویت: <bdi>{recovery.targetIdentityId}</bdi>
            <br />
            پیگیری: <bdi>{recovery.incidentId}</bdi>
            <br />
            دلیل: {recovery.reason}
            <br />
            تأییدهای ثبت‌شده: {recovery.approvalCount}
          </p>
          <Code value={code} onChange={setCode} />
          <button disabled={busy}>تأیید هویت و درخواست</button>
        </form>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
    </main>
  );
}
export function SessionSecurity() {
  const [targetIdentityId, setTarget] = useState("");
  const [incidentId, setIncidentId] = useState("");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const proof = await call("proofs", {
        action: "REVOKE_PUBLIC_SESSIONS",
        targetIdentityId,
        incidentId,
        reason,
        code,
      });
      setCode("");
      await call("session-revocations", {
        targetIdentityId,
        incidentId,
        reason,
        proof: proof.proof,
      });
      setMessage("نشست‌های فعلی بسته شدند. ورود بعدی همچنان ممکن است.");
    } catch (error) {
      setCode("");
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.page}>
      <h1>بستن نشست‌های یک هویت</h1>
      <p>
        شناسه حادثه و دلیل را ثبت کنید. این اقدام نشست‌های فعلی را می‌بندد و مانع ورود
        بعدی نمی‌شود.
      </p>
      <form onSubmit={submit}>
        <label>
          شناسه هویت
          <input
            dir="ltr"
            required
            value={targetIdentityId}
            onChange={(event) => setTarget(event.target.value)}
          />
        </label>
        <label>
          شناسه حادثه
          <input
            required
            minLength={3}
            maxLength={100}
            value={incidentId}
            onChange={(event) => setIncidentId(event.target.value)}
          />
        </label>
        <label>
          دلیل اقدام
          <textarea
            required
            minLength={5}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <Code value={code} onChange={setCode} />
        <button disabled={busy}>بستن نشست‌ها</button>
      </form>
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
    </main>
  );
}
