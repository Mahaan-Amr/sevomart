"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { platformAgentSessionV2Contract } from "@sevo/contracts/identity-access/v2";
import styles from "../../../login/identity-login.module.css";

export function PlatformAgentLogin({ returnTo }: { returnTo: string }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/platform/auth/password/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      if (!response.ok) {
        setMessage(
          response.status === 429
            ? "تلاش‌ها زیاد شده است؛ کمی بعد دوباره تلاش کنید."
            : "نام کاربری یا رمز عبور درست نیست.",
        );
        return;
      }
      platformAgentSessionV2Contract.parse(await response.json());
      setPassword("");
      window.location.replace(returnTo);
    } catch {
      setMessage("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="platform-login-title">
        <span className={styles.brand}>سوو · عامل پلتفرم</span>
        <h1 id="platform-login-title">ورود به فضای بررسی</h1>
        <p className={styles.intro}>با اطلاعات حساب همکاری وارد شوید.</p>
        <form className={styles.form} onSubmit={submit}>
          <label htmlFor="platform-identifier">نام کاربری، شماره موبایل یا ایمیل</label>
          <input
            id="platform-identifier"
            dir="ltr"
            autoComplete="username"
            required
            maxLength={254}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
          <label htmlFor="platform-password">رمز عبور</label>
          <input
            id="platform-password"
            dir="ltr"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className={styles.message} role="alert" aria-live="polite">
            {message}
          </p>
          <button type="submit" disabled={pending}>
            {pending ? "در حال بررسی…" : "ورود"}
          </button>
          <Link href="/platform/login/recovery">کد بازیابی دارم</Link>
        </form>
      </section>
    </main>
  );
}
