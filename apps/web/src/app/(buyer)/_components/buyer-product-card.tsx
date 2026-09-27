"use client";

import Link from "next/link";

import styles from "./buyer-product-card.module.css";

type Target = "image" | "title" | "store";

export function BuyerProductCard({
  href,
  imageId,
  name,
  price,
  unavailable,
  store,
  onNavigate,
  focusPrefix,
}: {
  href: string;
  imageId: string;
  name: string;
  price: string;
  unavailable: boolean;
  store?: { name: string; href: string };
  onNavigate?: (target: Target) => void;
  focusPrefix?: string;
}) {
  return (
    <article className={styles.card}>
      <Link
        className={styles.imageLink}
        href={href}
        prefetch={false}
        aria-label={`دیدن ${name} و گزینه‌های آن`}
        data-feed-focus={focusPrefix ? `${focusPrefix}:image` : undefined}
        onNavigate={() => onNavigate?.("image")}
      >
        <img src={`/api/store/media/${imageId}`} alt="" width={400} height={400} />
      </Link>
      <div className={styles.info}>
        {store ? (
          <Link
            className={styles.store}
            href={store.href}
            prefetch={false}
            data-feed-focus={focusPrefix ? `${focusPrefix}:store` : undefined}
            onNavigate={() => onNavigate?.("store")}
          >
            {store.name}
          </Link>
        ) : null}
        <h2>
          <Link
            href={href}
            prefetch={false}
            data-feed-focus={focusPrefix ? `${focusPrefix}:title` : undefined}
            onNavigate={() => onNavigate?.("title")}
          >
            {name}
          </Link>
        </h2>
        <div className={styles.bottom}>
          <strong>{price}</strong>
          {unavailable ? <span>ناموجود</span> : null}
        </div>
        <span className={styles.detailLink} aria-hidden="true">
          دیدن کالا <span aria-hidden="true">←</span>
        </span>
      </div>
    </article>
  );
}
