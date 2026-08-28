"use client";

import {
  discoveryFeedPageV1Contract,
  type DiscoveryFeedPageV1,
} from "@sevo/contracts/discovery/v1";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatIrrAsToman } from "../../../lib/format-money";
import styles from "./discovery.module.css";

export function DiscoveryView({ cursor }: { cursor?: string }) {
  const [page, setPage] = useState<DiscoveryFeedPageV1>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
    void fetch(`/api/discovery${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const parsed = discoveryFeedPageV1Contract.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error("feed unavailable");
        if (!controller.signal.aborted) setPage(parsed.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [cursor, retry]);

  if (failed)
    return (
      <section className={styles.state}>
        <p role="alert">کالاها بارگیری نشدند. دوباره تلاش کنید.</p>
        <button
          onClick={() => {
            setFailed(false);
            setRetry(retry + 1);
          }}
        >
          تلاش دوباره
        </button>
        {cursor ? <Link href="/">دیدن تازه‌ترین کالاها</Link> : null}
      </section>
    );
  if (!page)
    return (
      <p className={styles.state} role="status">
        در حال دریافت کالاها…
      </p>
    );
  if (page.emptyState)
    return (
      <section className={styles.state}>
        <p>{page.emptyState.message}</p>
        <p>{page.emptyState.nextAction}</p>
        {cursor ? <Link href="/">بازگشت به کشف</Link> : null}
      </section>
    );

  return (
    <>
      <ul className={styles.grid} aria-label="کالاهای تازه">
        {page.items.map((item) => (
          <li key={item.productId}>
            <Link
              className={styles.product}
              href={`/s/${item.storeSlug}/products/${item.productId}`}
            >
              <img
                src={`/api/store/media/${item.product.image.id}`}
                alt=""
                width={300}
                height={300}
              />
              <h2>{item.product.name}</h2>
              <span>{item.store.name}</span>
              <strong>
                {item.priceRange.minimum.amount !== item.priceRange.maximum.amount
                  ? "از "
                  : ""}
                {formatIrrAsToman(item.priceRange.minimum.amount)}
              </strong>
              {item.availability === "OUT_OF_STOCK" ? <span>ناموجود</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      {page.nextCursor ? (
        <Link href={`/?${new URLSearchParams({ cursor: page.nextCursor })}`}>
          کالاهای بعدی
        </Link>
      ) : null}
    </>
  );
}
