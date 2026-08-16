"use client";

import {
  otpChallengeContract,
  sellerSessionContract,
} from "@sevo/contracts/identity-access/v1";
import { useEffect, useRef, useState, type FormEvent } from "react";

import styles from "./seller-login.module.css";

type Step = "mobile" | "code" | "signed-in";
type ApiError = { message?: string };

export function SellerLogin({
  initiallySignedIn,
  showDevelopmentCode,
}: {
  initiallySignedIn: boolean;
  showDevelopmentCode: boolean;
}) {
  const [step, setStep] = useState<Step>(initiallySignedIn ? "signed-in" : "mobile");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/otp/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mobile }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(humanError(body));
        return;
      }
      const challenge = otpChallengeContract.safeParse(body);
      if (!challenge.success) throw new Error("invalid challenge response");
      setChallengeId(challenge.data.challengeId);
      setStep("code");
    } catch {
      setMessage("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/otp/verifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(humanError(body));
        return;
      }
      if (!sellerSessionContract.safeParse(body).success) {
        throw new Error("invalid session response");
      }
      setStep("signed-in");
    } catch {
      setMessage("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  if (step === "signed-in") {
    return (
      <main className={styles.page}>
        <section className={styles.panel} aria-labelledby="signed-in-title">
          <span className={styles.brand}>سوو</span>
          <h1 id="signed-in-title">وارد شدید</h1>
          <p>نشست شما حفظ شده و می‌توانید ساخت فروشگاه را ادامه دهید.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-title">
        <span className={styles.brand}>سوو</span>
        <h1 id="login-title">ورود به فضای فروشنده</h1>
        <p className={styles.intro}>
          {step === "mobile"
            ? "شماره تست را وارد کنید تا کد ورود آماده شود."
            : `کد شش‌رقمی برای ${mobile} آماده است.`}
        </p>

        {step === "mobile" ? (
          <form onSubmit={requestOtp} className={styles.form} noValidate>
            <label htmlFor="seller-mobile">شماره موبایل</label>
            <input
              id="seller-mobile"
              name="mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              dir="ltr"
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
              aria-describedby={message ? "login-message" : undefined}
            />
            <StatusMessage message={message} />
            <button type="submit" disabled={pending}>
              {pending ? "در حال دریافت…" : "دریافت کد"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className={styles.form} noValidate>
            {showDevelopmentCode ? (
              <div className={styles.devCode} aria-label="کد آزمایشی 111111">
                <span>کد آزمایشی</span>
                <b dir="ltr">111111</b>
              </div>
            ) : null}
            <label htmlFor="seller-code">کد شش‌رقمی</label>
            <input
              ref={codeInput}
              id="seller-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              dir="ltr"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-describedby={message ? "login-message" : undefined}
            />
            <StatusMessage message={message} />
            <button type="submit" disabled={pending}>
              {pending ? "در حال بررسی…" : "ورود"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setStep("mobile");
                setCode("");
                setMessage("");
              }}
            >
              تغییر شماره
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function StatusMessage({ message }: { message: string }) {
  return (
    <p id="login-message" className={styles.message} role="alert" aria-live="polite">
      {message}
    </p>
  );
}

function humanError(body: unknown): string {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as ApiError).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "درخواست انجام نشد. دوباره تلاش کنید.";
}
