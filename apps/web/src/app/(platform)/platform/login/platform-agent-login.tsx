"use client";

import {
  otpChallengeContract,
  platformAgentSessionContract,
} from "@sevo/contracts/identity-access/v1";
import { useEffect, useRef, useState, type FormEvent } from "react";

import styles from "../../../login/identity-login.module.css";

type Step = "mobile" | "code";

export function PlatformAgentLogin() {
  const [step, setStep] = useState<Step>("mobile");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const verification = step === "code";
      const response = await fetch(
        `/api/platform/auth/otp/${verification ? "verifications" : "requests"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(verification ? { challengeId, code } : { mobile }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(humanError(body));
        return;
      }
      if (verification) {
        platformAgentSessionContract.parse(body);
        window.location.replace("/platform");
      } else {
        const challenge = otpChallengeContract.parse(body);
        setChallengeId(challenge.challengeId);
        setStep("code");
      }
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
        <p className={styles.intro}>
          {step === "mobile"
            ? "با شماره‌ای که مجوز بررسی دارد وارد شوید."
            : `کد شش‌رقمی ارسال‌شده برای ${mobile} را وارد کنید.`}
        </p>
        <form className={styles.form} onSubmit={submit} noValidate>
          <label htmlFor="platform-credential">
            {step === "mobile" ? "شماره موبایل" : "کد شش‌رقمی"}
          </label>
          <input
            ref={step === "code" ? codeInput : undefined}
            id="platform-credential"
            type={step === "mobile" ? "tel" : "text"}
            inputMode="numeric"
            autoComplete={step === "mobile" ? "tel" : "one-time-code"}
            maxLength={step === "code" ? 6 : 11}
            dir="ltr"
            value={step === "mobile" ? mobile : code}
            onChange={(event) =>
              step === "mobile"
                ? setMobile(event.target.value)
                : setCode(event.target.value)
            }
          />
          <p className={styles.message} role="alert" aria-live="polite">
            {message}
          </p>
          <button type="submit" disabled={pending}>
            {pending ? "در حال بررسی…" : step === "mobile" ? "دریافت کد" : "ورود"}
          </button>
        </form>
      </section>
    </main>
  );
}

function humanError(body: unknown) {
  return typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
    ? body.message
    : "درخواست انجام نشد. دوباره تلاش کنید.";
}
