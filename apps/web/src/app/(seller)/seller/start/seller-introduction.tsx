"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./seller-start.module.css";

const slides = [
  {
    title: "فروشگاه خودتان در سوو",
    text: "کالاها، سفارش‌ها و گفت‌وگوهای فروشگاهتان را در یک مسیر پیگیری کنید.",
  },
  {
    title: "فروش با مسئولیت روشن",
    text: "قیمت، موجودی، ارسال و سیاست مرجوعی فروشگاهتان را دقیق و به‌روز نگه دارید.",
  },
  {
    title: "پرداخت و پیگیری روشن",
    text: "تسویه مستقیم است. سوو مشکل را پیگیری می‌کند، اما بازپرداخت را تضمین نمی‌کند.",
  },
];

export function SellerIntroduction() {
  const [step, setStep] = useState(0);
  const [transition, setTransition] = useState<"next" | "previous" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primary = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const focusPrimary = useRef(false);
  useEffect(() => {
    if (focusPrimary.current) {
      primary.current?.focus();
      focusPrimary.current = false;
    }
  }, [step]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function move(to: number, focusReplacement = false) {
    if (transition || to < 0 || to >= slides.length || to === step) return;
    focusPrimary.current = focusReplacement;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(to);
      return;
    }
    setTransition(to > step ? "next" : "previous");
    timer.current = setTimeout(() => {
      setStep(to);
      timer.current = setTimeout(() => setTransition(null), 180);
    }, 160);
  }
  const slide = slides[step]!;
  return (
    <main className={styles.page} dir="rtl">
      <div className={`${styles.photo} ${styles[`photo${step}`]}`} aria-hidden="true" />
      <div className={styles.shade} aria-hidden="true" />
      {transition && (
        <div
          className={`${styles.transition} ${transition === "previous" ? styles.reverse : ""}`}
          aria-hidden="true"
        />
      )}
      <header className={styles.top}>
        <Link href="/">سوو</Link>
      </header>
      <section className={styles.content} aria-labelledby="intro-title">
        <p className={styles.kicker}>شروع فروشندگی در سوو</p>
        <div className={styles.copy} aria-live="polite">
          <h1 id="intro-title">{slide.title}</h1>
          <p>{slide.text}</p>
        </div>
        <p className={styles.disclaimer}>
          ثبت درخواست به معنی تأیید خودکار فروشندگی نیست
        </p>
        <div className={styles.actions}>
          {step < 2 ? (
            <button
              ref={primary as React.RefObject<HTMLButtonElement>}
              className={styles.primary}
              onClick={(event) =>
                move(
                  step + 1,
                  step === 1 && document.activeElement === event.currentTarget,
                )
              }
              aria-disabled={!!transition}
            >
              بعدی
            </button>
          ) : (
            <Link
              ref={primary as React.RefObject<HTMLAnchorElement>}
              className={styles.primary}
              href="/seller/application"
            >
              شروع درخواست فروشندگی
            </Link>
          )}
          {step > 0 && (
            <button
              className={styles.back}
              onClick={(event) =>
                move(
                  step - 1,
                  step === 1 && document.activeElement === event.currentTarget,
                )
              }
              aria-disabled={!!transition}
            >
              قبلی
            </button>
          )}
        </div>
        <nav className={styles.progress} aria-label="مراحل معرفی">
          {slides.map((item, index) => (
            <button
              key={item.title}
              onClick={() => move(index)}
              aria-disabled={!!transition}
              aria-label={`مرحله ${index + 1}: ${item.title}`}
              aria-current={index === step ? "step" : undefined}
            >
              <span />
            </button>
          ))}
        </nav>
        <p className={styles.count}>مرحله {step + 1} از ۳</p>
      </section>
    </main>
  );
}
