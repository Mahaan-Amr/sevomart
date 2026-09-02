"use client";

import {
  buyerOrderSnapshotContract,
  type BuyerOrderSnapshot,
} from "@sevo/contracts/orders/v1";
import {
  directPaymentAttemptContract,
  directRefundContract,
  type DirectRefund,
} from "@sevo/contracts/payments/v1";
import {
  fulfillmentTimelineContract,
  type FulfillmentTimeline,
} from "@sevo/contracts/fulfillment/v1";
import { buyerDisputePageContract } from "@sevo/contracts/problem-follow-up/v1";
import Link from "next/link";
import { useEffect, useState } from "react";

import { newConversationHref } from "../../../../lib/conversation-navigation";
import { formatIrrAsToman } from "../../../../lib/format-money";
import { presentBuyerOrderState } from "../../../../lib/buyer-order-presentation";
import { readPurchaseExperienceEligibility } from "../../../../lib/purchase-experience-client";
import { BuyerDisputePanel } from "./buyer-dispute-panel";
import styles from "./order-tracking.module.css";

type BuyerDispute = ReturnType<typeof buyerDisputePageContract.parse>["items"][number];
type PurchaseExperienceState =
  "LOADING" | "ELIGIBLE" | "ALREADY_SUBMITTED" | "INELIGIBLE" | "ERROR";

export function OrderTracking({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<BuyerOrderSnapshot>();
  const [fulfillment, setFulfillment] = useState<FulfillmentTimeline>();
  const [refund, setRefund] = useState<DirectRefund>();
  const [dispute, setDispute] = useState<BuyerDispute>();
  const [supplementalState, setSupplementalState] = useState<
    Record<"fulfillment" | "refund" | "dispute", "LOADING" | "READY" | "ERROR">
  >({ fulfillment: "LOADING", refund: "LOADING", dispute: "LOADING" });
  const [copiedTrackingCode, setCopiedTrackingCode] = useState<string>();
  const [error, setError] = useState<"SIGNED_OUT" | "NOT_FOUND" | "UNAVAILABLE">();
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState(false);
  const [purchaseExperienceStates, setPurchaseExperienceStates] = useState<
    Record<string, PurchaseExperienceState>
  >({});

  useEffect(() => {
    let active = true;
    void fetch(`/api/orders/${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          if (active) setError("SIGNED_OUT");
          return;
        }
        if (response.status === 404) {
          if (active) setError("NOT_FOUND");
          return;
        }
        const parsed = buyerOrderSnapshotContract.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error("order unavailable");
        if (active) {
          setOrder(parsed.data);
          setPurchaseExperienceStates(
            Object.fromEntries(
              parsed.data.items.map((item) => [
                item.orderItemId,
                parsed.data.status === "PAID" ? "LOADING" : "INELIGIBLE",
              ]),
            ),
          );
        }
        await Promise.allSettled([
          ...(parsed.data.status === "PAID"
            ? parsed.data.items.map(async (item) => {
                try {
                  const result = await readPurchaseExperienceEligibility(
                    item.orderItemId,
                  );
                  if (result.status !== "READY") {
                    throw new Error("eligibility unavailable");
                  }
                  if (!active) return;
                  setPurchaseExperienceStates((current) => ({
                    ...current,
                    [item.orderItemId]: result.decision.eligible
                      ? "ELIGIBLE"
                      : result.decision.reason === "ALREADY_SUBMITTED"
                        ? "ALREADY_SUBMITTED"
                        : "INELIGIBLE",
                  }));
                } catch {
                  if (active) {
                    setPurchaseExperienceStates((current) => ({
                      ...current,
                      [item.orderItemId]: "ERROR",
                    }));
                  }
                }
              })
            : []),
          optionalRead(
            `/api/orders/${encodeURIComponent(orderId)}/fulfillment`,
            fulfillmentTimelineContract,
          )
            .then((value) => {
              if (!active) return;
              if (value) setFulfillment(value);
              setSupplementalState((current) => ({ ...current, fulfillment: "READY" }));
            })
            .catch(() => {
              if (active)
                setSupplementalState((current) => ({
                  ...current,
                  fulfillment: "ERROR",
                }));
            }),
          optionalRead(
            `/api/orders/${encodeURIComponent(orderId)}/direct-refund`,
            directRefundContract,
          )
            .then((value) => {
              if (!active) return;
              if (value) setRefund(value);
              setSupplementalState((current) => ({ ...current, refund: "READY" }));
            })
            .catch(() => {
              if (active)
                setSupplementalState((current) => ({ ...current, refund: "ERROR" }));
            }),
          readBuyerDispute(orderId)
            .then((value) => {
              if (!active) return;
              if (value) setDispute(value);
              setSupplementalState((current) => ({ ...current, dispute: "READY" }));
            })
            .catch(() => {
              if (active)
                setSupplementalState((current) => ({ ...current, dispute: "ERROR" }));
            }),
        ]);
      })
      .catch(() => active && setError("UNAVAILABLE"));
    return () => {
      active = false;
    };
  }, [orderId]);

  async function continuePayment() {
    setPaying(true);
    setPaymentError(false);
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/payment-attempts`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: "{}",
        },
      );
      const parsed = directPaymentAttemptContract.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("payment unavailable");
      if (parsed.data.redirectUrl) window.location.assign(parsed.data.redirectUrl);
      else
        window.location.assign(
          `/orders/${orderId}/payment-result?${new URLSearchParams({ attemptId: parsed.data.attemptId })}`,
        );
    } catch {
      setPaymentError(true);
      setPaying(false);
    }
  }

  if (error) {
    const message =
      error === "SIGNED_OUT"
        ? "برای دیدن این سفارش دوباره وارد هویت سوو شوید."
        : error === "NOT_FOUND"
          ? "این سفارش پیدا نشد یا به هویت سوو شما تعلق ندارد."
          : "جزئیات سفارش در دسترس نیست. کمی بعد دوباره تلاش کنید.";
    return (
      <section
        className={styles.message}
        role={error === "UNAVAILABLE" ? "alert" : "status"}
      >
        <h1>پیگیری سفارش</h1>
        <p>{message}</p>
        <Link
          href={
            error === "SIGNED_OUT"
              ? `/login?returnTo=${encodeURIComponent(`/orders/${orderId}`)}&cancelTo=%2Forders`
              : "/orders"
          }
        >
          {error === "SIGNED_OUT" ? "ورود و ادامه" : "بازگشت به سفارش‌ها"}
        </Link>
      </section>
    );
  }
  if (!order)
    return (
      <p className={styles.message} role="status">
        در حال دریافت سفارش…
      </p>
    );

  const state =
    order.status === "PAID" && supplementalState.fulfillment === "ERROR"
      ? {
          label: "پرداخت تأیید شد",
          nextStep:
            "وضعیت آماده‌سازی و ارسال اکنون در دسترس نیست؛ کمی بعد دوباره بررسی کنید.",
        }
      : presentBuyerOrderState(order.status, refund?.status, fulfillment?.status);
  const conversationHref = newConversationHref(
    { kind: "ORDER", storeId: order.store.storeId, orderId },
    `/orders/${orderId}`,
  );
  return (
    <article className={styles.page}>
      <Link className={styles.back} href="/orders">
        همه سفارش‌ها
      </Link>
      <header className={styles.hero}>
        <p>{order.store.name}</p>
        <h1>{state.label}</h1>
        <p>{state.nextStep}</p>
        {order.status === "PENDING_PAYMENT" ? (
          <>
            <button
              className={styles.primary}
              disabled={paying}
              onClick={continuePayment}
            >
              {paying
                ? "در حال شروع پرداخت…"
                : `ادامه پرداخت ${formatIrrAsToman(order.total.amount)}`}
            </button>
            {paymentError ? (
              <p role="alert">شروع پرداخت ممکن نشد. وضعیت سفارش را تازه کنید.</p>
            ) : null}
          </>
        ) : null}
      </header>

      <details className={styles.disclosure} open>
        <summary id="snapshot-title">خلاصه ثبت‌شده سفارش</summary>
        <div className={styles.disclosureBody} aria-labelledby="snapshot-title">
          <ul className={styles.items}>
            {order.items.map((item) => {
              const experienceState =
                purchaseExperienceStates[item.orderItemId] ?? "LOADING";
              const returnTo = `/orders/${order.orderId}`;
              const experienceHref = `/purchase-experiences/new?${new URLSearchParams({
                orderItemId: item.orderItemId,
                returnTo,
              })}`;
              return (
                <li key={item.orderItemId}>
                  <div className={styles.itemSummary}>
                    <span>
                      {item.name} ×{" "}
                      {new Intl.NumberFormat("fa-IR").format(item.quantity)}
                    </span>
                    <strong>{formatIrrAsToman(item.lineTotal.amount)}</strong>
                  </div>
                  {experienceState === "ELIGIBLE" ? (
                    <Link
                      className={styles.itemAction}
                      href={experienceHref}
                      aria-label={`ثبت تجربه خرید برای ${item.name}`}
                    >
                      ثبت تجربه خرید
                    </Link>
                  ) : (
                    <span
                      className={styles.itemState}
                      role={experienceState === "LOADING" ? "status" : undefined}
                    >
                      {purchaseExperienceStateLabel(experienceState)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <dl className={styles.facts}>
            <div>
              <dt>مبلغ نهایی</dt>
              <dd>{formatIrrAsToman(order.total.amount)}</dd>
            </div>
            <div>
              <dt>روش پرداخت</dt>
              <dd>تسویه مستقیم با فروشگاه</dd>
            </div>
            <div>
              <dt>روش ارسال</dt>
              <dd>
                {order.shippingMethod.label}؛{" "}
                {order.shippingMethod.estimatedDeliveryText}
              </dd>
            </div>
            <div>
              <dt>زمان ثبت</dt>
              <dd>{formatDate(order.createdAt)}</dd>
            </div>
          </dl>
          {order.delivery ? (
            <div className={styles.trust}>
              <h3>نشانی ثبت‌شده برای تحویل</h3>
              <p>
                {order.delivery.recipientName}،{" "}
                <bdi>{order.delivery.recipientMobile}</bdi>
              </p>
              <p>
                {order.delivery.provinceText}، {order.delivery.cityText}،{" "}
                {order.delivery.addressLine}
                {order.delivery.postalCode ? (
                  <>
                    ، کد پستی <bdi>{order.delivery.postalCode}</bdi>
                  </>
                ) : null}
              </p>
            </div>
          ) : null}
          <div className={styles.trust}>
            <h3>سیاست مرجوعی ثبت‌شده هنگام سفارش</h3>
            <p>{order.returnPolicy.text}</p>
            <p>
              سوو گزارش مشکل و تخلف را پیگیری می‌کند، اما بازپرداخت را تضمین نمی‌کند.
            </p>
          </div>
        </div>
      </details>

      <details className={styles.disclosure} open>
        <summary id="tracking-title">رهگیری و خط زمانی</summary>
        <div className={styles.disclosureBody} aria-labelledby="tracking-title">
          <h3>وضعیت سفارش</h3>
          <ol className={styles.timeline}>
            <li>
              <strong>سفارش ثبت شد</strong>
              <time dateTime={order.createdAt}>{formatDate(order.createdAt)}</time>
            </li>
            {order.timeline.map((entry, index) => (
              <li key={`${entry.toStatus}-${entry.occurredAt}-${index}`}>
                <strong>{orderTransitionLabel(entry.reasonCode)}</strong>
                <time dateTime={entry.occurredAt}>{formatDate(entry.occurredAt)}</time>
              </li>
            ))}
          </ol>
          <h3 className={styles.subheading}>ارسال</h3>
          {supplementalState.fulfillment === "ERROR" ? (
            <p role="status">
              وضعیت ارسال اکنون در دسترس نیست؛ کمی بعد دوباره تلاش کنید.
            </p>
          ) : fulfillment ? (
            <ol className={styles.timeline}>
              {fulfillment.timeline.map((entry, index) => (
                <li key={`${entry.status}-${entry.occurredAt}-${index}`}>
                  <strong>{fulfillmentLabel(entry.status)}</strong>
                  <time dateTime={entry.occurredAt}>
                    {formatDate(entry.occurredAt)}
                  </time>
                  {entry.shipping?.trackingCode ? (
                    <span className={styles.trackingCode}>
                      کد رهگیری: <bdi>{entry.shipping.trackingCode}</bdi>{" "}
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(entry.shipping!.trackingCode!)
                            .then(() =>
                              setCopiedTrackingCode(entry.shipping!.trackingCode),
                            );
                        }}
                      >
                        {copiedTrackingCode === entry.shipping.trackingCode
                          ? "کپی شد"
                          : "کپی کد"}
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : supplementalState.fulfillment === "LOADING" ? (
            <p role="status">در حال دریافت وضعیت ارسال…</p>
          ) : (
            <p>پس از تأیید پرداخت، آماده‌سازی و ارسال در این بخش ثبت می‌شود.</p>
          )}
        </div>
      </details>

      <details className={styles.disclosure}>
        <summary id="problem-title">اختلاف و بازپرداخت</summary>
        <div className={styles.disclosureBody} aria-labelledby="problem-title">
          {supplementalState.dispute === "ERROR" ? (
            <p role="status">
              وضعیت پرونده اختلاف اکنون در دسترس نیست؛ کمی بعد دوباره تلاش کنید.
            </p>
          ) : supplementalState.dispute === "LOADING" ? (
            <p role="status">در حال دریافت وضعیت اختلاف…</p>
          ) : !dispute && supplementalState.fulfillment === "ERROR" ? (
            <p role="status">
              امکان بررسی مهلت ثبت اختلاف اکنون در دسترس نیست؛ کمی بعد وضعیت ارسال را
              دوباره دریافت کنید.
            </p>
          ) : (
            <BuyerDisputePanel
              orderId={orderId}
              fulfillment={fulfillment}
              dispute={dispute}
              onOpened={setDispute}
            />
          )}
          {supplementalState.refund === "ERROR" ? (
            <p role="status">
              وضعیت بازپرداخت اکنون در دسترس نیست؛ کمی بعد دوباره تلاش کنید.
            </p>
          ) : refund ? (
            <dl className={styles.facts}>
              <div>
                <dt>وضعیت بازپرداخت</dt>
                <dd>{refundStatusLabel(refund.status)}</dd>
              </div>
              <div>
                <dt>مبلغ</dt>
                <dd>{formatIrrAsToman(refund.amount.amount)}</dd>
              </div>
              <div>
                <dt>آخرین پیگیری</dt>
                <dd>{formatDate(refund.updatedAt)}</dd>
              </div>
            </dl>
          ) : supplementalState.refund === "LOADING" ? (
            <p role="status">در حال دریافت وضعیت بازپرداخت…</p>
          ) : (
            <p>بازپرداختی برای این سفارش ثبت نشده است.</p>
          )}
          <p>
            {dispute
              ? "برای هماهنگی مستقیم با فروشگاه، گفت‌وگوی همین سفارش را باز کنید؛ سابقه رسمی پرونده در بالا می‌ماند."
              : "اگر هنوز برای حل مشکل به هماهنگی نیاز دارید، گفت‌وگوی همین سفارش را باز کنید."}
          </p>
          <Link className={styles.secondaryLink} href={conversationHref}>
            گفت‌وگو درباره سفارش
          </Link>
        </div>
      </details>
    </article>
  );
}

function purchaseExperienceStateLabel(state: PurchaseExperienceState) {
  return {
    LOADING: "در حال بررسی امکان ثبت تجربه…",
    ELIGIBLE: "ثبت تجربه خرید",
    ALREADY_SUBMITTED: "تجربه این خرید ثبت شده است.",
    INELIGIBLE: "این قلم فعلاً شرایط ثبت تجربه را ندارد.",
    ERROR: "امکان ثبت تجربه اکنون در دسترس نیست.",
  }[state];
}

async function optionalRead<Output>(
  path: string,
  contract: {
    safeParse(value: unknown): { success: true; data: Output } | { success: false };
  },
) {
  const response = await fetch(path, { cache: "no-store" });
  if (response.status === 404) return undefined;
  const parsed = contract.safeParse(await response.json());
  if (!response.ok || !parsed.success) throw new Error("supplemental read unavailable");
  return parsed.data;
}

async function readBuyerDispute(orderId: string) {
  let cursor: string | null = null;
  do {
    const search = new URLSearchParams({ limit: "100" });
    if (cursor) search.set("cursor", cursor);
    const page = await optionalRead(
      `/api/buyer/disputes?${search}`,
      buyerDisputePageContract,
    );
    if (!page) return undefined;
    const match = page.items.find((item) => item.orderId === orderId);
    if (match) return match;
    cursor = page.nextCursor;
  } while (cursor);
  return undefined;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function fulfillmentLabel(status: FulfillmentTimeline["status"]) {
  return (
    {
      ACTION_REQUIRED: "در انتظار اقدام فروشگاه",
      PREPARING: "در حال آماده‌سازی",
      SHIPPED: "ارسال شد",
      DELIVERED: "تحویل شد",
      CANCELLATION_PENDING_REFUND: "لغو در انتظار بازپرداخت",
      CANCELLED: "لغو شد",
    } as const
  )[status];
}
function refundStatusLabel(status: DirectRefund["status"]) {
  return (
    {
      PENDING: "در حال تأیید درگاه",
      FAILED: "ناموفق؛ نیازمند تلاش دوباره فروشگاه",
      CONFIRMED: "تأییدشده",
    } as const
  )[status];
}
function orderTransitionLabel(
  reason: BuyerOrderSnapshot["timeline"][number]["reasonCode"],
) {
  return (
    {
      PAYMENT_CONFIRMED: "پرداخت تأیید شد",
      PAYMENT_DISPATCH_UNRESOLVED: "نتیجه پرداخت نیازمند بررسی شد",
      PAYMENT_CONFIRMED_STOCK_CONFLICT: "پرداخت تأیید شد؛ موجودی نیازمند بررسی است",
      PAYMENT_PROVIDER_CONFLICT: "گزارش درگاه نیازمند بررسی شد",
      PAYMENT_FAILED: "پرداخت ناموفق ثبت شد",
      PAID_STOCK_CONFLICT: "موجودی سفارش پرداخت‌شده نیازمند بررسی شد",
      REFUND_REQUESTED: "بازپرداخت درخواست شد",
      REFUND_CONFIRMED: "بازپرداخت تأیید شد",
    } as const
  )[reason];
}
