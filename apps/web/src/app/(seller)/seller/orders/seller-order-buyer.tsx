"use client";

import {
  type RevealedOrderDeliveryDetails,
  type StoreBuyerOrder,
  type StoreBuyerSummary,
} from "@sevo/contracts/orders/v1";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { fulfillmentLabel, paymentLabel } from "./seller-buyer-presentation";
import {
  readRelatedBuyers,
  readStoreBuyerOrders,
  revealOrderDeliveryDetails,
  SellerSessionExpired,
} from "./seller-buyers-client";
import styles from "./seller-order-buyer.module.css";

export function SellerOrderBuyer({ orderId }: { orderId: string }) {
  const [buyer, setBuyer] = useState<StoreBuyerSummary>();
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<StoreBuyerOrder[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState<RevealedOrderDeliveryDetails>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const revealedHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void readRelatedBuyers(orderId)
      .then((page) => {
        const relatedBuyer = page.items.find(
          (item) =>
            item.matchedOrderId === orderId || item.latestOrder.orderId === orderId,
        );
        if (!relatedBuyer) throw new Error("خریدار مرتبط با این سفارش پیدا نشد.");
        setBuyer(relatedBuyer);
        setReady(true);
      })
      .catch((caught) => {
        if (caught instanceof SellerSessionExpired) {
          window.location.assign("/seller/login");
          return;
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "اطلاعات خریدار دریافت نشد. دوباره تلاش کنید.",
        );
        setReady(true);
      });
  }, [orderId]);

  useEffect(() => {
    void readStoreBuyerOrders(orderId)
      .then((page) => {
        setHistory(page.items);
        setHistoryCursor(page.nextCursor);
      })
      .catch((caught) => {
        if (caught instanceof SellerSessionExpired) {
          window.location.assign("/seller/login");
          return;
        }
        setHistoryError(
          caught instanceof Error
            ? caught.message
            : "تاریخچه سفارش‌های این خریدار دریافت نشد.",
        );
      })
      .finally(() => setHistoryReady(true));
  }, [orderId]);

  useEffect(() => {
    if (details) revealedHeadingRef.current?.focus();
  }, [details]);

  async function reveal(event: React.FormEvent) {
    event.preventDefault();
    const humanReason = reason.trim();
    if (humanReason.length < 10) {
      setError("دلیل این پیگیری را کمی روشن‌تر بنویسید.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      setDetails(await revealOrderDeliveryDetails(orderId, humanReason));
    } catch (caught) {
      if (caught instanceof SellerSessionExpired) {
        window.location.assign("/seller/login");
        return;
      }
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "اطلاعات تحویل نمایش داده نشد. دوباره تلاش کنید.",
      );
    } finally {
      setPending(false);
    }
  }

  async function loadMoreHistory() {
    if (!historyCursor || historyPending) return;
    setHistoryPending(true);
    setHistoryError(undefined);
    try {
      const page = await readStoreBuyerOrders(orderId, historyCursor);
      setHistory((current) => [...current, ...page.items]);
      setHistoryCursor(page.nextCursor);
    } catch (caught) {
      if (caught instanceof SellerSessionExpired) {
        window.location.assign("/seller/login");
        return;
      }
      setHistoryError(
        caught instanceof Error
          ? caught.message
          : "ادامه تاریخچه سفارش‌ها دریافت نشد. دوباره تلاش کنید.",
      );
    } finally {
      setHistoryPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="buyer-title">
        <Link className={styles.back} href="/seller/orders">
          بازگشت به سفارش‌ها
        </Link>
        <p className={styles.eyebrow}>سفارش {orderId}</p>
        <h1 id="buyer-title">خریدار این سفارش</h1>
        <p className={styles.context}>
          این اطلاعات فقط برای انجام یا پیگیری همین سفارش است؛ یادداشت، برچسب‌گذاری و
          پیام گروهی در این مسیر وجود ندارد.
        </p>

        {!ready ? <p role="status">در حال دریافت خریدار سفارش…</p> : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}

        {buyer ? (
          <>
            <div className={styles.summary}>
              <div>
                <h2>{buyer.displayName}</h2>
                <p>{buyer.maskedMobile ?? "شماره تماس ماسک شده است"}</p>
              </div>
              <dl>
                <div>
                  <dt>سفارش‌های همین فروشگاه</dt>
                  <dd>{buyer.orderCount.toLocaleString("fa-IR")}</dd>
                </div>
                <div>
                  <dt>سفارش فعلی</dt>
                  <dd className={styles.orderId}>{orderId}</dd>
                </div>
                <div>
                  <dt>آخرین سفارش خریدار</dt>
                  <dd className={styles.orderId}>{buyer.latestOrder.orderId}</dd>
                </div>
                <div>
                  <dt>وضعیت آخرین سفارش خریدار</dt>
                  <dd>{fulfillmentLabel(buyer.latestOrder.fulfillmentStatus)}</dd>
                </div>
              </dl>
              <p className={styles.nextStep}>
                قدم بعدی: برای انجام یا پیگیری همین سفارش، فقط در صورت نیاز اطلاعات
                تحویل را با دلیل ثبت‌شده ببینید. برای سفارش دیگر همین خریدار، شماره آن
                سفارش را در جست‌وجوی خریداران وارد کنید.
              </p>
            </div>

            <BuyerOrderHistory
              currentOrderId={orderId}
              orders={history}
              ready={historyReady}
              pending={historyPending}
              hasMore={Boolean(historyCursor)}
              error={historyError}
              onLoadMore={loadMoreHistory}
            />

            {!details ? (
              <form className={styles.revealForm} onSubmit={reveal}>
                <div>
                  <h2>شماره تماس و نشانی فعلاً ماسک‌اند</h2>
                  <p>
                    برای هماهنگی یا پیگیری لازم، دلیل انسانی بنویسید. مشاهده در سابقه
                    دسترسی حساس ثبت می‌شود و این صفحه اطلاعات را ذخیره نمی‌کند.
                  </p>
                </div>
                <label htmlFor="delivery-reveal-reason">
                  دلیل مشاهده شماره و نشانی
                </label>
                <textarea
                  id="delivery-reveal-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  minLength={10}
                  maxLength={500}
                  rows={4}
                  required
                  aria-describedby="delivery-reveal-help"
                />
                <small id="delivery-reveal-help">
                  نمونه: هماهنگی زمان تحویل یا پیگیری مشکل اعلام‌شده همین سفارش.
                </small>
                <button type="submit" disabled={pending}>
                  {pending ? "در حال بررسی…" : "نمایش اطلاعات تحویل"}
                </button>
              </form>
            ) : (
              <RevealedDetails details={details} headingRef={revealedHeadingRef} />
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}

function BuyerOrderHistory({
  currentOrderId,
  orders,
  ready,
  pending,
  hasMore,
  error,
  onLoadMore,
}: {
  currentOrderId: string;
  orders: StoreBuyerOrder[];
  ready: boolean;
  pending: boolean;
  hasMore: boolean;
  error?: string;
  onLoadMore: () => Promise<void>;
}) {
  return (
    <section className={styles.history} aria-labelledby="buyer-history-title">
      <div>
        <h2 id="buyer-history-title">تاریخچه سفارش‌های همین فروشگاه</h2>
        <p>فقط سفارش‌های این خریدار در فروشگاه شما نمایش داده می‌شوند.</p>
      </div>
      {!ready ? <p role="status">در حال دریافت تاریخچه سفارش‌ها…</p> : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {ready && orders.length === 0 && !error ? (
        <p>سفارش دیگری برای این خریدار پیدا نشد.</p>
      ) : null}
      {orders.length > 0 ? (
        <ul>
          {orders.map((order) => (
            <li key={order.orderId}>
              <div className={styles.historyHeading}>
                <Link href={`/seller/orders/${order.orderId}/buyer`}>
                  سفارش <span className={styles.orderId}>{order.orderId}</span>
                </Link>
                {order.orderId === currentOrderId ? <span>سفارش فعلی</span> : null}
              </div>
              <dl>
                <div>
                  <dt>زمان ثبت</dt>
                  <dd>{formatDate(order.createdAt)}</dd>
                </div>
                <div>
                  <dt>پرداخت</dt>
                  <dd>{paymentLabel(order.paymentStatus)}</dd>
                </div>
                <div>
                  <dt>انجام سفارش</dt>
                  <dd>{fulfillmentLabel(order.fulfillmentStatus)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : null}
      {hasMore ? (
        <button type="button" disabled={pending} onClick={() => void onLoadMore()}>
          {pending ? "در حال دریافت…" : "نمایش سفارش‌های بیشتر"}
        </button>
      ) : null}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function RevealedDetails({
  details,
  headingRef,
}: {
  details: RevealedOrderDeliveryDetails;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <section className={styles.revealed} aria-labelledby="revealed-title">
      <h2 id="revealed-title" ref={headingRef} tabIndex={-1}>
        اطلاعات تحویل برای این پیگیری
      </h2>
      <dl>
        <div>
          <dt>گیرنده</dt>
          <dd>{details.recipientName}</dd>
        </div>
        <div>
          <dt>شماره تماس</dt>
          <dd className={styles.ltr}>{details.recipientMobile}</dd>
        </div>
        <div>
          <dt>وضعیت انجام همین سفارش</dt>
          <dd>{fulfillmentLabel(details.fulfillmentStatus)}</dd>
        </div>
        <div>
          <dt>نشانی</dt>
          <dd>
            {details.address.provinceText}، {details.address.cityText}،{` `}
            {details.address.addressLine}
          </dd>
        </div>
        {details.address.postalCode ? (
          <div>
            <dt>کد پستی</dt>
            <dd className={styles.ltr}>{details.address.postalCode}</dd>
          </div>
        ) : null}
      </dl>
      <p>
        فقط برای قدم فعلی سفارش استفاده کنید. با خروج از صفحه، برای مشاهده دوباره باید
        دلیل تازه ثبت شود.
      </p>
    </section>
  );
}
