"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import styles from "../../../../login/identity-login.module.css";
export default function RecoveryPage() {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/platform/auth/password/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, password }),
      });
      if (!response.ok) {
        setMessage("کد معتبر نیست یا مهلت آن گذشته است. از سوپرادمین کد تازه بگیرید.");
        return;
      }
      setCode("");
      setPassword("");
      setDone(true);
    } catch {
      setMessage("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <h1>بازیابی دسترسی</h1>
        <p>کدی را که سوپرادمین به شما داده وارد کنید و یک رمز تازه بسازید.</p>
        {done ? (
          <p role="status">
            رمز تازه ثبت شد. <Link href="/platform/login">ورود به حساب</Link>
          </p>
        ) : (
          <form className={styles.form} onSubmit={submit}>
            <label htmlFor="recovery-code">کد بازیابی</label>
            <input
              id="recovery-code"
              dir="ltr"
              autoComplete="off"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <label htmlFor="new-password">رمز تازه</label>
            <input
              id="new-password"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p>رمز باید دست‌کم ۱۲ نویسه باشد.</p>
            <p role="alert">{message}</p>
            <button disabled={busy}>ثبت رمز تازه</button>
          </form>
        )}
      </section>
    </main>
  );
}
