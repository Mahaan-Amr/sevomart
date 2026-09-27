"use client";

import { publicSalesContentFeedV2Contract } from "@sevo/contracts/content/v2";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { SalesContentProductView } from "../../../lib/sales-content-view-model";
import styles from "./storefront.module.css";

type Feed = ReturnType<typeof publicSalesContentFeedV2Contract.parse>;
type Content = Feed["items"][number];

export function StoreSalesContent({
  store,
  products,
}: {
  store: { id: string; name: string; slug: string };
  products: readonly SalesContentProductView[];
}) {
  const [feed, setFeed] = useState<Feed | null>();
  const [selected, setSelected] = useState<Content | null>(null);
  const [brokenMedia, setBrokenMedia] = useState<ReadonlySet<string>>(new Set());
  const dialog = useRef<HTMLDialogElement>(null);

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

  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
  }, [selected]);

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
  if (feed.items.length === 0) return null;

  const productById = new Map(products.map((product) => [product.productId, product]));
  const connectedProducts = selected?.products
    .filter((product) => product.active)
    .flatMap((product) => {
      const visible = productById.get(product.productId);
      return visible ? [visible] : [];
    });

  return (
    <section className={styles.salesContent} aria-labelledby="sales-content-title">
      <h2 id="sales-content-title">محتوای فروش</h2>
      <div className={styles.salesContentGrid}>
        {feed.items.map((item, index) => (
          <button
            className={styles.salesContentCover}
            key={item.contentId}
            type="button"
            aria-label={`دیدن محتوای فروش ${index + 1} از ${store.name}`}
            onClick={() => setSelected(item)}
          >
            {brokenMedia.has(item.media.mediaId) ? (
              <span className={styles.brokenContentMedia} role="status">
                {item.media.kind === "IMAGE"
                  ? "تصویر این محتوا باز نشد."
                  : "ویدیوی این محتوا باز نشد."}
              </span>
            ) : item.media.kind === "IMAGE" ? (
              <img
                src={`/api/store/media/${item.media.mediaId}`}
                alt=""
                onError={() =>
                  setBrokenMedia((current) => new Set(current).add(item.media.mediaId))
                }
              />
            ) : (
              <video
                src={`/api/store/media/${item.media.mediaId}`}
                preload="metadata"
                muted
                playsInline
                aria-hidden="true"
                onError={() =>
                  setBrokenMedia((current) => new Set(current).add(item.media.mediaId))
                }
              />
            )}
          </button>
        ))}
      </div>
      <dialog
        className={styles.salesContentDialog}
        ref={dialog}
        aria-label={`محتوای فروش ${store.name}`}
        onClose={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        {selected ? (
          <div className={styles.salesContentDetail}>
            <button
              className={styles.closeContent}
              type="button"
              onClick={() => dialog.current?.close()}
            >
              بستن
            </button>
            {brokenMedia.has(selected.media.mediaId) ? (
              <p role="status">
                {selected.media.kind === "IMAGE"
                  ? "تصویر این محتوا باز نشد."
                  : "ویدیوی این محتوا باز نشد."}
              </p>
            ) : selected.media.kind === "IMAGE" ? (
              <img
                className={styles.detailMedia}
                src={`/api/store/media/${selected.media.mediaId}`}
                alt={`محتوای فروش ${store.name}`}
                onError={() =>
                  setBrokenMedia((current) =>
                    new Set(current).add(selected.media.mediaId),
                  )
                }
              />
            ) : (
              <video
                className={styles.detailMedia}
                src={`/api/store/media/${selected.media.mediaId}`}
                controls
                playsInline
                onError={() =>
                  setBrokenMedia((current) =>
                    new Set(current).add(selected.media.mediaId),
                  )
                }
              />
            )}
            <h3>کالاهای این محتوا</h3>
            {connectedProducts?.length ? (
              <ul>
                {connectedProducts.map((product) => (
                  <li key={product.productId}>
                    <Link href={product.href}>
                      <span>{product.name}</span>
                      <span>{product.priceLabel}</span>
                      {product.unavailable ? <span>ناموجود</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>کالای متصل فعلاً برای خرید در دسترس نیست.</p>
            )}
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
