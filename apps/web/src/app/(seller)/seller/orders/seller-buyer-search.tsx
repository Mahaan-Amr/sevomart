"use client";

import { type StoreBuyerPage, type StoreBuyerSummary } from "@sevo/contracts/orders/v1";
import Link from "next/link";
import { useState } from "react";

import { fulfillmentLabel, relatedOrderId } from "./seller-buyer-presentation";
import { readRelatedBuyers, SellerSessionExpired } from "./seller-buyers-client";
import styles from "./seller-buyer-search.module.css";

export function SellerBuyerSearch() {
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [page, setPage] = useState<StoreBuyerPage>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function findBuyers(event: React.FormEvent) {
    event.preventDefault();
    const query = search.trim();
    if (!query) {
      setError("نام خریدار یا شماره سفارش را بنویسید.");
      return;
    }
    await loadPage(query);
  }

  async function loadPage(query: string, cursor?: string) {
    setPending(true);
    setError(undefined);
    try {
      const nextPage = await readRelatedBuyers(query, cursor);
      if (!cursor) setActiveSearch(query);
      setPage((current) =>
        cursor && current
          ? {
              items: [...current.items, ...nextPage.items],
              nextCursor: nextPage.nextCursor,
            }
          : nextPage,
      );
    } catch (caught) {
      if (caught instanceof SellerSessionExpired) {
        window.location.assign("/seller/login");
        return;
      }
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "خریداران مرتبط دریافت نشدند. دوباره تلاش کنید.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="buyer-search-title">
        <Link className={styles.back} href="/seller/orders">
          بازگشت به سفارش‌ها
        </Link>
        <div className={styles.intro}>
          <h1 id="buyer-search-title">پیدا کردن خریدار یک سفارش</h1>
          <p>فقط خریداران دارای سفارش در همین فروشگاه نشان داده می‌شوند.</p>
        </div>
        <form onSubmit={findBuyers} role="search">
          <label htmlFor="seller-buyer-search">نام خریدار یا شماره سفارش</label>
          <div className={styles.controls}>
            <input
              id="seller-buyer-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={120}
              autoComplete="off"
            />
            <button type="submit" disabled={pending}>
              {pending ? "در حال جست‌وجو…" : "پیدا کردن خریدار"}
            </button>
          </div>
        </form>
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        {page?.items.length === 0 ? (
          <p role="status">خریدار مرتبطی با این نام یا شماره سفارش پیدا نشد.</p>
        ) : null}
        {page?.items.length ? (
          <ul className={styles.results} aria-label="خریداران مرتبط">
            {page.items.map((buyer) => (
              <BuyerResult key={buyer.buyerId} buyer={buyer} />
            ))}
          </ul>
        ) : null}
        {page?.nextCursor ? (
          <button
            className={styles.more}
            type="button"
            disabled={pending}
            onClick={() => void loadPage(activeSearch, page.nextCursor ?? undefined)}
          >
            نمایش نتیجه‌های بیشتر
          </button>
        ) : null}
      </section>
    </main>
  );
}

function BuyerResult({ buyer }: { buyer: StoreBuyerSummary }) {
  const targetOrderId = relatedOrderId(buyer);
  return (
    <li>
      <div className={styles.identity}>
        <strong>{buyer.displayName}</strong>
        <span>{buyer.maskedMobile ?? "شماره تماس ماسک شده است"}</span>
      </div>
      <dl>
        <div>
          <dt>سفارش‌های همین فروشگاه</dt>
          <dd>{buyer.orderCount.toLocaleString("fa-IR")}</dd>
        </div>
        <div>
          <dt>آخرین سفارش</dt>
          <dd className={styles.orderId}>{buyer.latestOrder.orderId}</dd>
        </div>
        <div>
          <dt>تاریخ آخرین سفارش</dt>
          <dd>{formatDate(buyer.latestOrder.createdAt)}</dd>
        </div>
        <div>
          <dt>وضعیت انجام آخرین سفارش</dt>
          <dd>{fulfillmentLabel(buyer.latestOrder.fulfillmentStatus)}</dd>
        </div>
      </dl>
      <Link href={`/seller/orders/${targetOrderId}/buyer`}>دیدن خریدار در سفارش</Link>
    </li>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
