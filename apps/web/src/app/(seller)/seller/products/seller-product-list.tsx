"use client";

import {
  sellerProductListContract,
  type SellerProductSummary,
} from "@sevo/contracts/product/v1";
import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "../(workspace)/workspace-page.module.css";

const STATE_LABELS: Record<SellerProductSummary["state"], string> = {
  DRAFT: "پیش‌نویس",
  PUBLISHED: "منتشرشده",
  UNPUBLISHED: "توقف انتشار",
};

export function SellerProductList() {
  const [items, setItems] = useState<SellerProductSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>();
  const [message, setMessage] = useState("در حال بارگیری کالاها…");
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(undefined, controller.signal);
    return () => controller.abort();

    async function loadPage(cursor: string | undefined, signal: AbortSignal) {
      try {
        const page = await fetchProductPage(cursor, signal);
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setFailed(false);
        setMessage(page.items.length === 0 ? "هنوز کالایی نساخته‌اید." : "");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setMessage("کالاها بارگیری نشدند. دوباره تلاش کنید.");
          setFailed(true);
        }
      } finally {
        setPending(false);
      }
    }
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    setPending(true);
    setMessage("");
    try {
      const page = await fetchProductPage(nextCursor);
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setMessage("کالاهای بعدی بارگیری نشدند. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.productList} aria-labelledby="seller-product-list-title">
      <h2 id="seller-product-list-title">کالاهای شما</h2>
      {items.length > 0 ? (
        <ul aria-label="فهرست کالاها">
          {items.map((product) => (
            <li key={product.productId}>
              {product.primaryMediaId ? (
                <img
                  src={`/api/store/media/${product.primaryMediaId}`}
                  alt=""
                  width="64"
                  height="64"
                />
              ) : (
                <span className={styles.productPlaceholder} aria-hidden="true" />
              )}
              <span className={styles.productIdentity}>
                <strong>{product.name ?? "کالای بدون نام"}</strong>
                <span>{STATE_LABELS[product.state]}</span>
              </span>
              <Link
                className={styles.secondary}
                href={`/seller/products/${product.productId}/edit`}
              >
                ویرایش {product.name ?? "کالا"}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <p role={failed ? "alert" : "status"}>{message}</p> : null}
      {failed ? (
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() => window.location.reload()}
        >
          تلاش دوباره
        </button>
      ) : null}
      {nextCursor ? (
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={loadMore}
          disabled={pending}
        >
          {pending ? "در حال بارگیری…" : "دیدن کالاهای بیشتر"}
        </button>
      ) : null}
    </section>
  );
}

async function fetchProductPage(cursor?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/store/seller/products?${query}`, {
    cache: "no-store",
    signal,
  });
  const body: unknown = await response.json();
  const parsed = sellerProductListContract.safeParse(body);
  if (!response.ok || !parsed.success) throw new Error("seller products unavailable");
  return parsed.data;
}
