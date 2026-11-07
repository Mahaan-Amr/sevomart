"use client";

import { useState, type FormEvent } from "react";
import styles from "./identity-login.module.css";

type Mode = "enroll" | "login" | "recovery-request" | "recovery";
type Field = "mobile" | "code" | "password";
const fieldMessages: Record<Field, string> = {
  mobile: "شماره موبایل را با قالب ۰۹xxxxxxxxx وارد کنید.",
  code: "کد شش‌رقمی را کامل وارد کنید.",
  password: "رمز باید بین ۱۲ تا ۱۲۸ نویسه باشد.",
};

export function SellerPassword({
  initialMode,
  onBack,
  onLogin,
  showDevelopmentCode,
}: {
  initialMode: "enroll" | "login";
  onBack: (reset?: boolean) => void;
  onLogin: () => void;
  showDevelopmentCode: boolean;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const nextErrors: Partial<Record<Field, string>> = {};
    if ((mode === "login" || mode === "recovery-request") && !/^09\d{9}$/.test(mobile))
      nextErrors.mobile = fieldMessages.mobile;
    if (mode === "recovery" && !/^\d{6}$/.test(code))
      nextErrors.code = fieldMessages.code;
    if (mode !== "recovery-request" && (password.length < 12 || password.length > 128))
      nextErrors.password = fieldMessages.password;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setPending(true);
    const path =
      mode === "enroll"
        ? "/api/auth/password"
        : mode === "login"
          ? "/api/auth/password/sessions"
          : mode === "recovery-request"
            ? "/api/auth/password/recovery/requests"
            : "/api/auth/password/recovery";
    const payload =
      mode === "enroll"
        ? { password }
        : mode === "login"
          ? { mobile, password }
          : mode === "recovery-request"
            ? { mobile }
            : { challengeId, code, password };
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body: {
          message?: string;
          details?: { issues?: Array<{ field?: string }> };
        } = await response.json();
        const next: Partial<Record<Field, string>> = {};
        for (const issue of body.details?.issues ?? []) {
          if (
            issue.field === "mobile" ||
            issue.field === "code" ||
            issue.field === "password"
          )
            next[issue.field] = fieldMessages[issue.field];
        }
        if (Object.keys(next).length) setErrors(next);
        else setMessage(body.message ?? "درخواست انجام نشد. دوباره تلاش کنید.");
      } else if (mode === "recovery-request") {
        const body: { challengeId: string } = await response.json();
        setChallengeId(body.challengeId);
        setMode("recovery");
      } else if (mode === "login") {
        onLogin();
      } else {
        setPassword("");
        setDone(true);
      }
    } catch {
      setMessage("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="password-title">
        <span className={styles.brand}>سوو</span>
        <h1 id="password-title">
          {mode === "enroll"
            ? "ساخت رمز"
            : mode === "login"
              ? "ورود با رمز"
              : "بازیابی رمز"}
        </h1>
        {done ? (
          <>
            <p role="status">
              {mode === "enroll"
                ? "رمز ساخته شد."
                : "رمز تغییر کرد و نشست‌های عمومی این هویت بسته شدند. دوباره وارد شوید."}
            </p>
            <button
              type="button"
              className={styles.signOut}
              onClick={() => onBack(mode !== "enroll")}
            >
              بازگشت به ورود
            </button>
          </>
        ) : (
          <form className={styles.form} onSubmit={submit} noValidate>
            {(mode === "login" || mode === "recovery-request") && (
              <>
                <label htmlFor="password-mobile">شماره موبایل</label>
                <input
                  id="password-mobile"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  dir="ltr"
                  value={mobile}
                  onChange={(event) => {
                    setMobile(event.target.value);
                    setErrors((current) => ({ ...current, mobile: undefined }));
                  }}
                  aria-invalid={Boolean(errors.mobile)}
                  aria-describedby={errors.mobile ? "password-mobile-error" : undefined}
                  required
                />
                {errors.mobile && (
                  <p
                    id="password-mobile-error"
                    className={styles.fieldError}
                    role="alert"
                  >
                    {errors.mobile}
                  </p>
                )}
              </>
            )}
            {mode === "recovery" && (
              <>
                {showDevelopmentCode && (
                  <p>
                    کد آزمایشی: <b dir="ltr">111111</b>
                  </p>
                )}
                <label htmlFor="recovery-code">کد شش‌رقمی</label>
                <input
                  id="recovery-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setErrors((current) => ({ ...current, code: undefined }));
                  }}
                  aria-invalid={Boolean(errors.code)}
                  aria-describedby={errors.code ? "recovery-code-error" : undefined}
                  required
                />
                {errors.code && (
                  <p
                    id="recovery-code-error"
                    className={styles.fieldError}
                    role="alert"
                  >
                    {errors.code}
                  </p>
                )}
              </>
            )}
            {mode !== "recovery-request" && (
              <>
                <label htmlFor="seller-password">
                  {mode === "login" ? "رمز" : "رمز تازه، حداقل ۱۲ نویسه"}
                </label>
                <input
                  id="seller-password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={12}
                  maxLength={128}
                  dir="ltr"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setErrors((current) => ({ ...current, password: undefined }));
                  }}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    errors.password ? "seller-password-error" : undefined
                  }
                  required
                />
                {errors.password && (
                  <p
                    id="seller-password-error"
                    className={styles.fieldError}
                    role="alert"
                  >
                    {errors.password}
                  </p>
                )}
              </>
            )}
            <p className={styles.message} role="alert">
              {message}
            </p>
            <button disabled={pending}>
              {pending
                ? "در حال بررسی…"
                : mode === "enroll"
                  ? "ساخت رمز"
                  : mode === "login"
                    ? "ورود"
                    : mode === "recovery-request"
                      ? "دریافت کد"
                      : "تغییر رمز"}
            </button>
            {mode === "login" && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setMode("recovery-request");
                  setMessage("");
                  setErrors({});
                }}
              >
                رمزم را فراموش کرده‌ام
              </button>
            )}
            <button type="button" className={styles.secondary} onClick={() => onBack()}>
              بازگشت
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
