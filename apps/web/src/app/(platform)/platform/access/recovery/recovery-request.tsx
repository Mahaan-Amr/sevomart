"use client";
import { useState, type FormEvent } from "react";
import styles from "../../_components/platform-workspace.module.css";
export function RecoveryRequest() {
  const [identityId, setIdentityId] = useState("");
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setCode("");
    try {
      const response = await fetch("/api/platform/auth/password/recovery-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId, reason, ...(username ? { username } : {}) }),
      });
      if (!response.ok) {
        setMessage("درخواست انجام نشد. دسترسی و شناسه همکار را بررسی کنید.");
        return;
      }
      const body = await response.json();
      setCode(body.code);
      setReason("");
    } catch {
      setMessage("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.statusPage}>
      <section className={styles.statusPanel}>
        <h1>بازیابی دسترسی همکار</h1>
        <p>شناسه همکار و دلیل بازیابی را وارد کنید.</p>
        {code ? (
          <div role="status">
            <p>
              این کد فقط همین یک بار نمایش داده می‌شود. آن را از مسیر امن به همکار
              برسانید؛ کد تا ده دقیقه معتبر است.
            </p>
            <p dir="ltr">
              <bdi>{code}</bdi>
            </p>
            <button onClick={() => setCode("")}>کد را رساندم</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="recovery-identity">شناسه همکار</label>
            <input
              id="recovery-identity"
              dir="ltr"
              required
              value={identityId}
              onChange={(event) => setIdentityId(event.target.value)}
            />
            <label htmlFor="recovery-username">
              نام کاربری برای همکار تازه (اختیاری)
            </label>
            <input
              id="recovery-username"
              dir="ltr"
              pattern="[a-z][a-z0-9._-]{2,99}"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <p>اگر همکار پیش‌تر حساب نداشته، نام کاربری تازه را وارد کنید.</p>
            <label htmlFor="recovery-reason">دلیل بازیابی</label>
            <textarea
              id="recovery-reason"
              required
              minLength={10}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <p role="alert">{message}</p>
            <button disabled={busy}>دریافت کد بازیابی</button>
          </form>
        )}
      </section>
    </main>
  );
}
