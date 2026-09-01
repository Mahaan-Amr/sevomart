"use client";

import {
  discoveryFeedPageV1Contract,
  discoveryFollowingFeedPageV1Contract,
  type DiscoveryFeedItemV1,
} from "@sevo/contracts/discovery/v1";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatIrrAsToman } from "../../../lib/format-money";
import { loginHref } from "../../../lib/navigation";
import { appendFeedPage, emptyFeedState, replaceFeedPage } from "./feed-state";
import { type FeedKind, useFeedWorkspace } from "./feed-workspace";
import styles from "./discovery.module.css";

type FeedViewProps = {
  kind: FeedKind;
  initialCursor?: string;
};

export function FeedView({ kind, initialCursor }: FeedViewProps) {
  const { restored, states, setFeedState, saveForLogin } = useFeedWorkspace();
  const state = states[kind];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [failedCursor, setFailedCursor] = useState<string>();
  const [notice, setNotice] = useState("");
  const started = useRef(false);
  const request = useRef<AbortController | undefined>(undefined);

  const load = useCallback(
    async (cursor: string | undefined, replace: boolean) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setPending(true);
      setError("");
      setFailedCursor(undefined);
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
      try {
        const response = await fetch(`/api/${kind}${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        if (response.status === 401 && kind === "following") {
          saveForLogin(kind, window.scrollY);
          window.location.assign(loginHref("/following", "/"));
          return;
        }
        if (!response.ok) {
          const code = errorCode(body);
          if (
            cursor &&
            ["INVALID_CURSOR", "CURSOR_EXPIRED", "FEED_CURSOR_STALE"].includes(code)
          ) {
            setNotice(
              kind === "following"
                ? "فروشگاه‌های دنبال‌شده تغییر کردند؛ فید را تازه کردیم."
                : "فید را تازه کردیم.",
            );
            setFeedState(kind, { ...emptyFeedState });
            await load(undefined, true);
            return;
          }
          setError(humanError(body));
          setFailedCursor(cursor);
          return;
        }
        const parsed =
          kind === "following"
            ? discoveryFollowingFeedPageV1Contract.safeParse(body)
            : discoveryFeedPageV1Contract.safeParse(body);
        if (!parsed.success) throw new Error("invalid feed response");
        setFeedState(kind, (current) =>
          replace
            ? replaceFeedPage(current, parsed.data)
            : appendFeedPage(current, parsed.data),
        );
      } catch {
        if (!controller.signal.aborted) {
          setError("کالاها بارگیری نشدند. دوباره تلاش کنید.");
          setFailedCursor(cursor);
        }
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    },
    [kind, saveForLogin, setFeedState],
  );

  useEffect(() => {
    if (!restored || started.current) return;
    started.current = true;
    if (!state.snapshotAt) void load(initialCursor, true);
  }, [initialCursor, load, restored, state.snapshotAt]);

  useEffect(() => () => request.current?.abort(), []);

  if (!restored || (!state.snapshotAt && pending)) return <FeedLoading />;

  if (!state.snapshotAt && error) {
    return <FeedError message={error} onRetry={() => void load(failedCursor, true)} />;
  }

  return (
    <section aria-label={kind === "discovery" ? "فید کشف" : "فید دنبال‌شده‌ها"}>
      <div className={styles.feedMeta} aria-live="polite">
        {kind === "following" && state.visibleFollowedStoreCount !== undefined ? (
          <span>
            {new Intl.NumberFormat("fa-IR").format(state.visibleFollowedStoreCount)}
            {" فروشگاه دنبال‌شده"}
          </span>
        ) : null}
        {state.projectionUpdatedAt ? (
          <time dateTime={state.projectionUpdatedAt}>
            به‌روزرسانی تا {formatFreshness(state.projectionUpdatedAt)}
          </time>
        ) : null}
      </div>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      {state.items.length > 0 ? <FeedGrid items={state.items} /> : null}
      {state.emptyState ? (
        <div className={styles.state}>
          <p>{state.emptyState.message}</p>
          {kind === "following" ? (
            <Link href="/">{state.emptyState.nextAction}</Link>
          ) : (
            <p>{state.emptyState.nextAction}</p>
          )}
        </div>
      ) : null}
      {error ? (
        <FeedError
          message={error}
          compact
          onRetry={() => void load(failedCursor, !state.snapshotAt)}
        />
      ) : null}
      {state.nextCursor ? (
        <button
          type="button"
          className={styles.more}
          disabled={pending}
          onClick={() => void load(state.nextCursor, false)}
        >
          {pending ? "در حال دریافت…" : "دیدن کالاهای بیشتر"}
        </button>
      ) : null}
    </section>
  );
}

function FeedGrid({ items }: { items: DiscoveryFeedItemV1[] }) {
  return (
    <ul className={styles.grid} aria-label="کالاهای تازه">
      {items.map((item) => (
        <li key={item.productId}>
          <article className={styles.product}>
            <Link
              className={styles.imageLink}
              href={`/s/${item.storeSlug}/products/${item.productId}`}
              aria-label={`دیدن ${item.product.name}`}
            >
              <img
                src={`/api/store/media/${item.product.image.id}`}
                alt=""
                width={300}
                height={300}
              />
            </Link>
            <h2>
              <Link href={`/s/${item.storeSlug}/products/${item.productId}`}>
                {item.product.name}
              </Link>
            </h2>
            <Link className={styles.storeLink} href={`/s/${item.storeSlug}`}>
              {item.store.name}
            </Link>
            <strong>
              {item.priceRange.minimum.amount !== item.priceRange.maximum.amount
                ? "از "
                : ""}
              {formatIrrAsToman(item.priceRange.minimum.amount)}
            </strong>
            {item.availability === "OUT_OF_STOCK" ? (
              <span className={styles.unavailable}>ناموجود</span>
            ) : null}
          </article>
        </li>
      ))}
    </ul>
  );
}

function FeedLoading() {
  return (
    <section className={styles.loading} aria-label="در حال دریافت کالاها">
      <p role="status">در حال دریافت کالاها…</p>
      <div className={styles.loadingGrid} aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </section>
  );
}

function FeedError({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? styles.inlineError : styles.state}>
      <p role="alert">{message}</p>
      <button type="button" onClick={onRetry}>
        تلاش دوباره
      </button>
    </div>
  );
}

function errorCode(body: unknown) {
  if (typeof body === "object" && body !== null && "code" in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === "string" ? code : "";
  }
  return "";
}

function humanError(body: unknown) {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "کالاها بارگیری نشدند. دوباره تلاش کنید.";
}

function formatFreshness(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
