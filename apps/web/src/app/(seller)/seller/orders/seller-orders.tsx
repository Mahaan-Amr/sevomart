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

export function SellerOrders() {
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
            if (order.status === "CANCELLATION_PENDING_REFUND") return order;
            const fulfillmentResponse = await fetch(
              `/api/seller/orders/${encodeURIComponent(order.orderId)}/fulfillment`,
              { cache: "no-store" },
            );
            // IDs come from the store-scoped actionable list. Here, 404 means the
            // fulfillment projection has not caught up with a newly paid order yet.
            if (fulfillmentResponse.status === 404) return order;
            const fulfillment = fulfillmentTimelineContract.safeParse(
              await fulfillmentResponse.json(),
            );
            if (!fulfillmentResponse.ok || !fulfillment.success) {
              throw new Error("fulfillment unavailable");
            }
            return fulfillment.data.nextStatus ? order : undefined;
          }),
        );
        setOrders(actionable.filter((order) => order !== undefined));
      })
      .catch(() => setFailed(true));
  }, []);
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="orders-title">
        <h1 id="orders-title">سفارش‌های آماده اقدام</h1>
        {failed ? <p role="alert">سفارش‌ها دریافت نشدند. دوباره تلاش کنید.</p> : null}
        {orders?.length === 0 ? <p>فعلاً سفارش پرداخت‌شده‌ای ندارید.</p> : null}
        <ul>
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
      </section>
    </main>
  );
}
