"use client";

import {
  advanceFulfillmentInputContract,
  fulfillmentTimelineContract,
  type FulfillmentStatus,
  type FulfillmentTimeline,
} from "@sevo/contracts/fulfillment/v1";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./seller-order-fulfillment.module.css";

export function SellerOrderFulfillment({ orderId }: { orderId: string }) {
  const [timeline, setTimeline] = useState<FulfillmentTimeline>();
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string>();
  const [errorOccurrence, setErrorOccurrence] = useState(0);
  const [pending, setPending] = useState(false);
  const [shippingMethod, setShippingMethod] = useState("");
  const [trackingCode, setTrackingCode] = useState("");
  const [invalidShippingFields, setInvalidShippingFields] = useState<{
    method: boolean;
    trackingCode: boolean;
  }>({ method: false, trackingCode: false });
  const [completedStatus, setCompletedStatus] = useState<FulfillmentStatus>();
  const resultRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const loadTimeline = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/seller/orders/${encodeURIComponent(orderId)}/fulfillment`,
        { cache: "no-store" },
      );
      if (response.status === 401) {
        window.location.assign("/seller/login");
        return;
      }
      if (response.status === 404) {
        setUnavailable(true);
        setTimeline(undefined);
        setReady(true);
        return;
      }
      const parsed = fulfillmentTimelineContract.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error();
      if (!parsed.data.nextStatus) {
        setUnavailable(true);
        setTimeline(undefined);
        setReady(true);
        return;
      }
      setTimeline(parsed.data);
      setUnavailable(false);
      setReady(true);
    } catch {
      setError("وضعیت انجام سفارش دریافت نشد. دوباره تلاش کنید.");
      setErrorOccurrence((occurrence) => occurrence + 1);
      setReady(true);
    }
  }, [orderId]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  useEffect(() => {
    if (completedStatus) resultRef.current?.focus();
  }, [completedStatus]);

  useEffect(() => {
    if (errorOccurrence > 0) errorRef.current?.focus();
  }, [errorOccurrence]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!timeline?.nextStatus) return;
    const input =
      timeline.nextStatus === "SHIPPED"
        ? {
            targetStatus: timeline.nextStatus,
            shipping: {
              method: shippingMethod.trim(),
              ...(trackingCode.trim() ? { trackingCode: trackingCode.trim() } : {}),
            },
          }
        : { targetStatus: timeline.nextStatus };
    const parsedInput = advanceFulfillmentInputContract.safeParse(input);
    if (!parsedInput.success) {
      setInvalidShippingFields({
        method: parsedInput.error.issues.some(
          (issue) => issue.path.join(".") === "shipping.method",
        ),
        trackingCode: parsedInput.error.issues.some(
          (issue) => issue.path.join(".") === "shipping.trackingCode",
        ),
      });
      setError(
        timeline.nextStatus === "SHIPPED"
          ? "روش ارسال را کامل کنید؛ کد رهگیری در صورت ثبت باید دست‌کم دو نویسه باشد."
          : "این تغییر وضعیت معتبر نیست.",
      );
      setErrorOccurrence((occurrence) => occurrence + 1);
      return;
    }

    setInvalidShippingFields({ method: false, trackingCode: false });
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/seller/orders/${encodeURIComponent(orderId)}/fulfillment/advance`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify(parsedInput.data),
        },
      );
      const body: unknown = await response.json();
      if (response.status === 404) {
        setUnavailable(true);
        setTimeline(undefined);
        return;
      }
      if (response.status === 409) {
        await loadTimeline();
        setError(
          readErrorMessage(body, "وضعیت سفارش تغییر کرده است؛ وضعیت تازه را ببینید."),
        );
        setErrorOccurrence((occurrence) => occurrence + 1);
        return;
      }
      const parsed = fulfillmentTimelineContract.safeParse(body);
      if (!response.ok || !parsed.success) {
        throw new Error(
          readErrorMessage(body, "تغییر وضعیت ثبت نشد. دوباره تلاش کنید."),
        );
      }
      setTimeline(parsed.data);
      setCompletedStatus(parsedInput.data.targetStatus);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تغییر وضعیت ثبت نشد. دوباره تلاش کنید.",
      );
      setErrorOccurrence((occurrence) => occurrence + 1);
    } finally {
      setPending(false);
    }
  }

  if (ready && unavailable) {
    return (
      <main className={styles.page}>
        <section className={styles.panel} aria-labelledby="unavailable-title">
          <Link className={styles.back} href="/seller/orders">
            بازگشت به سفارش‌ها
          </Link>
          <h1 id="unavailable-title">این سفارش برای اقدام در دسترس نیست</h1>
          <p>
            سفارش‌های بسته یا متعلق به فروشگاه دیگر از این مسیر نمایش داده نمی‌شوند.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="fulfillment-title">
        <Link className={styles.back} href="/seller/orders">
          بازگشت به سفارش‌ها
        </Link>
        <p className={styles.eyebrow}>سفارش {orderId}</p>
        <h1 id="fulfillment-title">انجام سفارش</h1>
        {!ready ? <p role="status">در حال دریافت وضعیت…</p> : null}
        {error ? (
          <p
            className={styles.error}
            id="fulfillment-error"
            ref={errorRef}
            role="alert"
            tabIndex={-1}
          >
            {error}
          </p>
        ) : null}

        {completedStatus ? (
          <h2 className={styles.result} ref={resultRef} tabIndex={-1}>
            {completionTitle(completedStatus)}
          </h2>
        ) : null}

        {timeline?.nextStatus ? (
          <>
            <div className={styles.current}>
              <span>وضعیت اکنون</span>
              <strong>{statusTitle(timeline.status)}</strong>
            </div>

            <form className={styles.form} onSubmit={submit} noValidate>
              {timeline.nextStatus === "SHIPPED" ? (
                <>
                  <label htmlFor="shipping-method">روش ارسال</label>
                  <input
                    id="shipping-method"
                    value={shippingMethod}
                    onChange={(event) => {
                      setShippingMethod(event.target.value);
                      setInvalidShippingFields((fields) => ({
                        ...fields,
                        method: false,
                      }));
                    }}
                    minLength={2}
                    maxLength={80}
                    required
                    aria-invalid={invalidShippingFields.method}
                    aria-describedby={
                      invalidShippingFields.method ? "fulfillment-error" : undefined
                    }
                  />
                  <label htmlFor="tracking-code">کد رهگیری</label>
                  <input
                    id="tracking-code"
                    value={trackingCode}
                    onChange={(event) => {
                      setTrackingCode(event.target.value);
                      setInvalidShippingFields((fields) => ({
                        ...fields,
                        trackingCode: false,
                      }));
                    }}
                    minLength={2}
                    maxLength={100}
                    aria-invalid={invalidShippingFields.trackingCode}
                    aria-describedby={
                      invalidShippingFields.trackingCode
                        ? "fulfillment-error tracking-help"
                        : "tracking-help"
                    }
                  />
                  <small id="tracking-help">
                    اگر شرکت ارسال کد رهگیری داده است، همان کد را اینجا ثبت کنید.
                  </small>
                </>
              ) : null}
              <button type="submit" disabled={pending}>
                {pending ? "در حال ثبت…" : actionTitle(timeline.nextStatus)}
              </button>
            </form>

            {(["ACTION_REQUIRED", "PREPARING"] as FulfillmentStatus[]).includes(
              timeline.status,
            ) ? (
              <Link className={styles.cancel} href={`/seller/orders/${orderId}/refund`}>
                لغو پیش از ارسال و پیگیری بازپرداخت
              </Link>
            ) : null}

            <section className={styles.history} aria-labelledby="history-title">
              <h2 id="history-title">مسیر ثبت‌شده سفارش</h2>
              <ol>
                {timeline.timeline.map((entry) => (
                  <li key={`${entry.occurredAt}-${entry.status}`}>
                    <strong>{statusTitle(entry.status)}</strong>
                    <time dateTime={entry.occurredAt}>
                      {new Date(entry.occurredAt).toLocaleString("fa-IR")}
                    </time>
                    {entry.shipping ? (
                      <span>
                        {entry.shipping.method}
                        {entry.shipping.trackingCode
                          ? ` — ${entry.shipping.trackingCode}`
                          : ""}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}

function readErrorMessage(body: unknown, fallback: string) {
  return typeof body === "object" && body && "message" in body
    ? String(body.message)
    : fallback;
}

function actionTitle(status: FulfillmentStatus) {
  return fulfillmentStatusPresentation[status].action ?? "ثبت تغییر وضعیت";
}

function completionTitle(status: FulfillmentStatus) {
  return fulfillmentStatusPresentation[status].completion ?? "وضعیت سفارش ثبت شد";
}

function statusTitle(status: FulfillmentStatus) {
  return fulfillmentStatusPresentation[status].title;
}

const fulfillmentStatusPresentation: Record<
  FulfillmentStatus,
  { title: string; action?: string; completion?: string }
> = {
  ACTION_REQUIRED: { title: "نیازمند اقدام" },
  PREPARING: {
    title: "در حال آماده‌سازی",
    action: "شروع آماده‌سازی",
    completion: "آماده‌سازی سفارش شروع شد",
  },
  SHIPPED: {
    title: "ارسال‌شده",
    action: "ثبت ارسال سفارش",
    completion: "سفارش ارسال شد",
  },
  DELIVERED: {
    title: "تحویل‌شده",
    action: "ثبت تحویل سفارش",
    completion: "تحویل سفارش ثبت شد",
  },
  CANCELLATION_PENDING_REFUND: { title: "لغو در انتظار بازپرداخت" },
  CANCELLED: { title: "لغوشده" },
};
