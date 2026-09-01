"use client";

import Link from "next/link";
import { useState } from "react";

import type { SalesContentCardView } from "../../lib/sales-content-view-model";
import styles from "./sales-content-grid.module.css";

export function SalesContentGrid({
  cards,
  stores,
  label,
}: {
  cards: readonly SalesContentCardView[];
  stores: ReadonlyMap<string, { name: string; href: string }>;
  label: string;
}) {
  if (cards.length === 0) return null;
  return (
    <ul className={styles.grid} aria-label={label}>
      {cards.map((card) => (
        <li key={card.contentId}>
          <article className={styles.card}>
            <SalesContentMedia card={card} />
            <span className={styles.source}>{card.sourceLabel}</span>
            {stores.get(card.storeId) ? (
              <Link className={styles.store} href={stores.get(card.storeId)!.href}>
                {stores.get(card.storeId)!.name}
              </Link>
            ) : null}
            {card.product ? (
              <>
                <h3>
                  <Link href={card.product.href}>{card.product.name}</Link>
                </h3>
                <strong>{card.product.priceLabel}</strong>
                {card.product.availabilityLabel ? (
                  <span className={styles.unavailable}>
                    {card.product.availabilityLabel}
                  </span>
                ) : null}
              </>
            ) : (
              <p className={styles.unavailable}>{card.unavailableLabel}</p>
            )}
          </article>
        </li>
      ))}
    </ul>
  );
}

function SalesContentMedia({ card }: { card: SalesContentCardView }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={styles.brokenMedia} role="status">
        {card.media.kind === "VIDEO"
          ? "ویدیوی این محتوا باز نشد."
          : "تصویر این محتوا باز نشد."}
      </div>
    );
  }
  const source = `/api/store/media/${card.media.mediaId}`;
  return card.media.kind === "VIDEO" ? (
    <video
      className={styles.media}
      src={source}
      controls
      playsInline
      preload="metadata"
      aria-label="ویدیوی کوتاه محتوای فروش"
      onError={() => setFailed(true)}
    />
  ) : (
    <img
      className={styles.media}
      src={source}
      alt=""
      width={300}
      height={300}
      onError={() => setFailed(true)}
    />
  );
}
