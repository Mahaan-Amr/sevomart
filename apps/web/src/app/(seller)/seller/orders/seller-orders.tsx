"use client";

import {
  sellerActionableOrderListContract,
  type SellerActionableOrder,
} from "@sevo/contracts/orders/v1";
import { fulfillmentTimelineContract } from "@sevo/contracts/fulfillment/v1";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatIrrAsToman } from "../../../../lib/format-money";
import styles from "./seller-orders.module.css";

export function SellerOrders({ filter }: { filter?: "OVERDUE_PREPARING" }) {
  const [orders, setOrders] = useState<SellerActionableOrder[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void fetch("/api/seller/orders", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign("/seller/login");
          return;
        }
        const parsed = sellerActionableOrderListContract.safeParse(
          await response.json(),
        );
        if (!response.ok || !parsed.success) throw new Error("orders unavailable");
        const actionable = await Promise.all(
          parsed.data.orders.map(async (order) => {
            if (order.status === "CANCELLATION_PENDING_REFUND") {
              return filter ? undefined : order;
            }
            const fulfillmentResponse = await fetch(
              `/api/seller/orders/${encodeURIComponent(order.orderId)}/fulfillment`,
              { cache: "no-store" },
            );
            // IDs come from the store-scoped actionable list. Here, 404 means the
            // fulfillment projection has not caught up with a newly paid order yet.
            if (fulfillmentResponse.status === 404) {
              return filter ? undefined : order;
            }
            const fulfillment = fulfillmentTimelineContract.safeParse(
              await fulfillmentResponse.json(),
            );
            if (!fulfillmentResponse.ok || !fulfillment.success) {
              throw new Error("fulfillment unavailable");
            }
            if (!fulfillment.data.nextStatus) return undefined;
            if (!filter) return order;
            const preparingAt = fulfillment.data.timeline.findLast(
              ({ status }) => status === "PREPARING",
            )?.occurredAt;
            return fulfillment.data.status === "PREPARING" &&
              preparingAt &&
              Date.parse(preparingAt) <= Date.now() - 24 * 60 * 60 * 1_000
              ? order
              : undefined;
          }),
        );
        setOrders(actionable.filter((order) => order !== undefined));
      })
      .catch(() => setFailed(true));
  }, [filter]);
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="orders-title">
        <h1 id="orders-title">
          {filter === "OVERDUE_PREPARING"
            ? "سفارش‌های در حال آماده‌سازی"
            : "سفارش‌های آماده اقدام"}
        </h1>
        {failed ? <p role="alert">سفارش‌ها دریافت نشدند. دوباره تلاش کنید.</p> : null}
        {orders?.length === 0 ? (
          <p>
            {filter === "OVERDUE_PREPARING"
              ? "فعلاً سفارشی در حال آماده‌سازی نیست."
              : "فعلاً سفارش پرداخت‌شده‌ای ندارید."}
          </p>
        ) : null}
        <ul className={styles.orders}>
          {orders?.map((order) => (
            <li key={order.orderId}>
              <span>
                <b>سفارش {order.orderId}</b>
                <small>{order.itemCount.toLocaleString("fa-IR")} کالا</small>
              </span>
              <strong>{formatIrrAsToman(order.total.amount)}</strong>
              <Link
                href={
                  order.status === "PAID"
                    ? `/seller/orders/${order.orderId}`
                    : `/seller/orders/${order.orderId}/refund`
                }
              >
                {order.status === "PAID" ? "انجام سفارش" : "دیدن وضعیت بازپرداخت"}
              </Link>
            </li>
          ))}
        </ul>
        <Link className={styles.buyerSearchLink} href="/seller/orders/buyers">
          پیدا کردن خریدار یک سفارش
        </Link>
      </section>
    </main>
  );
}
