"use client";

import {
  sellerActionableOrderListContract,
  type SellerActionableOrder,
} from "@sevo/contracts/orders/v1";
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
        setOrders(parsed.data.orders);
      })
      .catch(() => setFailed(true));
  }, []);
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="orders-title">
        <h1 id="orders-title">سفارش‌های آماده اقدام</h1>
        {failed ? <p role="alert">سفارش‌ها دریافت نشدند. دوباره تلاش کنید.</p> : null}
        {orders?.length === 0 ? <p>فعلاً سفارش پرداخت‌شده‌ای ندارید.</p> : null}
        <ul className={styles.orders}>
          {orders?.map((order) => (
            <li key={order.orderId}>
              <span>
                <b>سفارش {order.orderId}</b>
                <small>{order.itemCount.toLocaleString("fa-IR")} کالا</small>
              </span>
              <strong>{formatIrrAsToman(order.total.amount)}</strong>
              <Link href={`/seller/orders/${order.orderId}/refund`}>
                {order.status === "PAID"
                  ? "لغو و پیگیری بازپرداخت"
                  : "دیدن وضعیت بازپرداخت"}
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
