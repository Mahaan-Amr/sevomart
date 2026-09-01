"use client";

import {
  purchaseExperienceContract,
  purchaseExperienceEligibilityDecisionV2Contract,
} from "@sevo/contracts/content/v2";
import { useEffect, useRef, useState } from "react";

import { loginHref } from "../../../../lib/navigation";
import { readPurchaseExperienceEligibility } from "../../../../lib/purchase-experience-client";
import styles from "./purchase-experience.module.css";

type Eligibility = ReturnType<
  typeof purchaseExperienceEligibilityDecisionV2Contract.parse
>;

export function PurchaseExperienceForm({
  orderItemId,
  returnTo,
  resumePath,
}: {
  orderItemId: string;
  returnTo: string;
  resumePath: string;
}) {
  const [eligibility, setEligibility] = useState<Eligibility>();
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [published, setPublished] = useState(false);
  const idempotencyKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void readPurchaseExperienceEligibility(orderItemId)
      .then((result) => {
        if (result.status === "UNAUTHENTICATED") {
          window.location.assign(loginHref(resumePath, returnTo));
          return;
        }
        if (active) setEligibility(result.decision);
      })
      .catch(() => {
        if (active) setMessage("شرایط ثبت تجربه دریافت نشد. دوباره تلاش کنید.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderItemId, resumePath, returnTo]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eligibility?.eligible || rating < 1 || rating > 5) {
      setMessage("یک امتیاز از ۱ تا ۵ انتخاب کنید.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const requestKey = idempotencyKey.current ?? crypto.randomUUID();
      idempotencyKey.current = requestKey;
      const response = await fetch("/api/purchase-experiences", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": requestKey,
        },
        body: JSON.stringify({
          buyerId: eligibility.buyerId,
          orderItemId,
          rating,
          text,
          mediaIds: [],
        }),
      });
      const body: unknown = await response.json();
      if (response.status === 401) {
        window.location.assign(loginHref(resumePath, returnTo));
        return;
      }
      if (!response.ok) {
        const error = body as { code?: string; message?: string };
        if (error.code === "ALREADY_SUBMITTED") {
          setEligibility({ eligible: false, reason: "ALREADY_SUBMITTED" });
        }
        throw new Error(error.message ?? "ثبت تجربه انجام نشد.");
      }
      const parsed = purchaseExperienceContract.safeParse(body);
      if (!parsed.success) throw new Error("پاسخ ثبت تجربه معتبر نبود.");
      setPublished(true);
      setMessage("تجربه شما با نشان «خرید تأییدشده» منتشر شد.");
    } catch (error) {
      setMessage(
        error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
          ? error.message
          : "ارتباط با سرور کامل نشد. دوباره تلاش کنید.",
      );
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return <ExperienceState text="شرایط خرید در حال بررسی است…" />;
  }
  if (!eligibility?.eligible) {
    return (
      <main className={styles.page}>
        <section className={styles.panel} aria-labelledby="experience-title">
          <a className={styles.back} href={returnTo}>
            بازگشت
          </a>
          <h1 id="experience-title">ثبت تجربه خرید</h1>
          <p>
            {eligibility?.reason === "ALREADY_SUBMITTED"
              ? "برای این خرید قبلاً یک تجربه ثبت شده است."
              : "این خرید هنوز شرایط ثبت تجربه را ندارد."}
          </p>
          {message ? <p role="alert">{message}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="experience-title">
        <a className={styles.back} href={returnTo}>
          بازگشت
        </a>
        <h1 id="experience-title">تجربه این خرید را ثبت کنید</h1>
        <p className={styles.lead}>
          سوو این خرید و ارتباط آن با همان کالا و فروشگاه را تأیید کرده است.
        </p>
        {published ? (
          <div className={styles.success} role="status">
            <strong>منتشر شد</strong>
            <p>{message}</p>
            <a className={styles.primaryLink} href={returnTo}>
              بازگشت به سفارش
            </a>
          </div>
        ) : (
          <form className={styles.form} onSubmit={submit}>
            <fieldset disabled={pending}>
              <legend>امتیاز شما</legend>
              <div className={styles.ratings}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="rating"
                      value={value}
                      checked={rating === value}
                      onChange={() => {
                        setRating(value);
                        idempotencyKey.current = undefined;
                      }}
                      required
                    />
                    <span>{value.toLocaleString("fa-IR")}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor="experience-text">توضیح شما (اختیاری)</label>
            <textarea
              id="experience-text"
              value={text}
              maxLength={2000}
              rows={6}
              disabled={pending}
              onChange={(event) => {
                setText(event.target.value);
                idempotencyKey.current = undefined;
              }}
            />
            <span className={styles.counter}>
              {text.length.toLocaleString("fa-IR")} از ۲٬۰۰۰ نویسه
            </span>
            <p className={styles.moderation}>
              تجربه پس از ثبت با وضعیت «منتشرشده» و نشان «خرید تأییدشده» دیده می‌شود.
            </p>
            {message ? <p role="alert">{message}</p> : null}
            <button className={styles.primary} type="submit" disabled={pending}>
              {pending ? "در حال ثبت…" : "ثبت تجربه خرید"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function ExperienceState({ text }: { text: string }) {
  return (
    <main className={styles.page}>
      <section className={styles.panel} role="status">
        <h1>ثبت تجربه خرید</h1>
        <p>{text}</p>
      </section>
    </main>
  );
}
