"use client";

import { publicSalesContentFeedV2Contract } from "@sevo/contracts/content/v2";
import { useEffect, useState } from "react";

import { SalesContentGrid } from "../../_components/sales-content-grid";
import {
  buildSalesContentCards,
  type SalesContentProductView,
} from "../../../lib/sales-content-view-model";
import styles from "./storefront.module.css";

export function StoreSalesContent({
  store,
  products,
}: {
  store: { id: string; name: string; slug: string };
  products: readonly SalesContentProductView[];
}) {
  const [feed, setFeed] = useState<ReturnType<
    typeof publicSalesContentFeedV2Contract.parse
  > | null>();

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ storeIds: store.id });
    void fetch(`/api/sales-content?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("sales content unavailable");
        const parsed = publicSalesContentFeedV2Contract.safeParse(
          await response.json(),
        );
        if (!parsed.success) throw new Error("invalid sales content");
        if (!controller.signal.aborted) setFeed(parsed.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFeed(null);
      });
    return () => controller.abort();
  }, [store.id]);

  if (feed === undefined) {
    return (
      <section className={styles.salesContent} aria-label="محتوای فروش">
        <p role="status">در حال دریافت محتوای فروش…</p>
      </section>
    );
  }
  if (feed === null) {
    return (
      <section className={styles.salesContent} aria-label="محتوای فروش">
        <p role="status">محتوای فروش فعلاً دریافت نشد.</p>
      </section>
    );
  }
  const cards = buildSalesContentCards(feed, products, {
    includeContentWithoutVisibleProducts: true,
  });
  if (cards.length === 0) return null;
  return (
    <section className={styles.salesContent} aria-labelledby="sales-content-title">
      <h2 id="sales-content-title">محتوای فروش</h2>
      <SalesContentGrid
        cards={cards}
        stores={new Map([[store.id, { name: store.name, href: `/s/${store.slug}` }]])}
        label="محتوای فروش فروشگاه"
      />
    </section>
  );
}
