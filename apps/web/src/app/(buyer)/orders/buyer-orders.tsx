"use client";

import {
  buyerOrderPageContract,
  type BuyerOrderSummary,
} from "@sevo/contracts/orders/v1";
import {
  purchaseGroupListContract,
  type PurchaseGroupV2,
} from "@sevo/contracts/orders/v2";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatIrrAsToman } from "../../../lib/format-money";
import { presentBuyerOrderState } from "../../../lib/buyer-order-presentation";
import styles from "./buyer-orders.module.css";

export function BuyerOrders() {
  const [orders, setOrders] = useState<readonly BuyerOrderSummary[]>();
  const [purchases, setPurchases] = useState<readonly PurchaseGroupV2[]>();
  const [error, setError] = useState<"SIGNED_OUT" | "UNAVAILABLE">();

  useEffect(() => {
    void Promise.all([
      fetch("/api/orders", { cache: "no-store" }),
      fetch("/api/purchase-groups", { cache: "no-store" }),
    ])
      .then(async ([response, groupsResponse]) => {
        if (response.status === 401) {
          setError("SIGNED_OUT");
          return;
        }
        const parsed = buyerOrderPageContract.safeParse(await response.json());
        const groups = purchaseGroupListContract.safeParse(await groupsResponse.json());
        if (!response.ok || !parsed.success || !groupsResponse.ok || !groups.success)
          throw new Error("orders unavailable");
        setPurchases(groups.data.items);
        const groupedOrderIds = new Set(
          groups.data.items.flatMap((group) =>
            group.stores.map((store) => store.orderId),
          ),
        );
        setOrders(
          parsed.data.items.filter((order) => !groupedOrderIds.has(order.orderId)),
        );
      })
      .catch(() => setError("UNAVAILABLE"));
  }, []);

  return (
    <section className={styles.page} aria-labelledby="buyer-orders-title">
      <header>
        <p>پیگیری خرید</p>
        <h1 id="buyer-orders-title">سفارش‌های من</h1>
        <p>وضعیت پرداخت، آماده‌سازی، ارسال و مشکل احتمالی را یک‌جا ببینید.</p>
      </header>
      {error === "SIGNED_OUT" ? (
        <div className={styles.message} role="status">
          <p>برای دیدن سفارش‌های خود وارد هویت سوو شوید.</p>
          <Link
            className={styles.primary}
            href="/login?returnTo=%2Forders&cancelTo=%2F"
          >
            ورود و دیدن سفارش‌ها
          </Link>
        </div>
      ) : error ? (
        <p className={styles.message} role="alert">
          سفارش‌ها در دسترس نیستند. کمی بعد دوباره تلاش کنید.
        </p>
      ) : orders?.length === 0 && purchases?.length === 0 ? (
        <div className={styles.message}>
          <p>هنوز سفارشی ثبت نکرده‌اید.</p>
          <Link href="/">دیدن کالاهای تازه</Link>
        </div>
      ) : orders && purchases ? (
        <ul className={styles.orders}>
          {purchases.map((purchase) => (
            <li key={purchase.groupId}>
              <Link href={`/purchases/${purchase.groupId}`}>
                <span>
                  <strong>
                    {purchase.stores.map((store) => store.name).join("، ")}
                  </strong>
                  <small>
                    {formatDate(purchase.createdAt)} · یک رسید برای{" "}
                    {purchase.stores.length.toLocaleString("fa-IR")} فروشگاه
                  </small>
                </span>
                <span>
                  <strong>{formatIrrAsToman(purchase.total.amount)}</strong>
                  <small>
                    {purchase.status === "PAID"
                      ? "پرداخت‌شده"
                      : purchase.status === "PAYMENT_REVIEW"
                        ? "در حال بررسی"
                        : purchase.status === "EXPIRED"
                          ? "منقضی‌شده"
                          : "منتظر پرداخت"}
                  </small>
                </span>
              </Link>
            </li>
          ))}
          {orders.map((order) => {
            const state = presentBuyerOrderState(order.status);
            return (
              <li key={order.orderId}>
                <Link href={`/orders/${order.orderId}`}>
                  <span>
                    <strong>{order.store.name}</strong>
                    <small>{formatDate(order.createdAt)}</small>
                  </span>
                  <span>
                    <strong>{formatIrrAsToman(order.total.amount)}</strong>
                    <small>{state.label}</small>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.message} role="status">
          در حال دریافت سفارش‌ها…
        </p>
      )}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
