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
import { classifyFeedError, cursorNotice, type FeedErrorState } from "./feed-errors";
import { appendFeedPage, emptyFeedState, replaceFeedPage } from "./feed-state";
import { type FeedKind, useFeedWorkspace } from "./feed-workspace";
import styles from "./discovery.module.css";

type FeedViewProps = {
  kind: FeedKind;
  initialCursor?: string;
};

export function FeedView({ kind, initialCursor }: FeedViewProps) {
  const { restored, states, setFeedState, saveForBrowse, saveDiscoveryForLogin } =
    useFeedWorkspace();
  const state = states[kind];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FeedErrorState>();
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
      setError(undefined);
      setFailedCursor(undefined);
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
      try {
        const response = await fetch(`/api/${kind}${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        if (response.status === 401 && kind === "following") {
          saveDiscoveryForLogin();
          window.location.assign(loginHref("/following", "/"));
          return;
        }
        if (!response.ok) {
          const code = errorCode(body);
          if (cursor && cursorNotice(code, kind)) {
            setNotice(cursorNotice(code, kind));
            setFeedState(kind, { ...emptyFeedState });
            await load(undefined, true);
            return;
          }
          setError(classifyFeedError(code));
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
          setError({
            message: "کالاها بارگیری نشدند. دوباره تلاش کنید.",
            retryable: true,
          });
          setFailedCursor(cursor);
        }
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    },
    [kind, saveDiscoveryForLogin, setFeedState],
  );

  useEffect(() => {
    if (!restored || started.current) return;
    started.current = true;
    if (!state.snapshotAt) void load(initialCursor, true);
  }, [initialCursor, load, restored, state.snapshotAt]);

  useEffect(() => () => request.current?.abort(), []);

  if (!restored || (!state.snapshotAt && pending)) return <FeedLoading />;

  if (!state.snapshotAt && error) {
    return <FeedError error={error} onRetry={() => void load(failedCursor, true)} />;
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
      <p className={styles.srOnly} role="status">
        {state.items.length > 0
          ? `${new Intl.NumberFormat("fa-IR").format(state.items.length)} کالا نمایش داده شد.`
          : "کالایی در این فید نمایش داده نشد."}
      </p>
      {state.items.length > 0 ? (
        <FeedGrid items={state.items} kind={kind} onLeave={saveForBrowse} />
      ) : null}
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
          error={error}
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

function FeedGrid({
  items,
  kind,
  onLeave,
}: {
  items: DiscoveryFeedItemV1[];
  kind: FeedKind;
  onLeave: (kind: FeedKind, scrollY: number, focusTarget: string) => void;
}) {
  return (
    <ul className={styles.grid} aria-label="کالاهای تازه">
      {items.map((item) => {
        const imageFocus = `${item.productId}:image`;
        const titleFocus = `${item.productId}:title`;
        const storeFocus = `${item.productId}:store`;
        const rememberOrigin = (focusTarget: string) =>
          onLeave(kind, window.scrollY, focusTarget);
        return (
          <li key={item.productId}>
            <article className={styles.product}>
              <Link
                className={styles.imageLink}
                href={`/s/${item.storeSlug}/products/${item.productId}`}
                aria-label={`دیدن ${item.product.name}`}
                data-feed-focus={imageFocus}
                onNavigate={() => rememberOrigin(imageFocus)}
              >
                <img
                  src={`/api/store/media/${item.product.image.id}`}
                  alt=""
                  width={300}
                  height={300}
                />
              </Link>
              <h2>
                <Link
                  href={`/s/${item.storeSlug}/products/${item.productId}`}
                  data-feed-focus={titleFocus}
                  onNavigate={() => rememberOrigin(titleFocus)}
                >
                  {item.product.name}
                </Link>
              </h2>
              <Link
                className={styles.storeLink}
                href={`/s/${item.storeSlug}`}
                data-feed-focus={storeFocus}
                onNavigate={() => rememberOrigin(storeFocus)}
              >
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
        );
      })}
    </ul>
  );
}

function FeedLoading() {
  return (
    <section className={styles.loading} aria-label="در حال دریافت کالاها">
      <p role="status">در حال دریافت کالاها…</p>
      <div className={styles.loadingGrid} aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => (
          <span className={styles.loadingCard} key={index}>
            <i />
            <b />
            <b />
            <b />
          </span>
        ))}
      </div>
    </section>
  );
}

function FeedError({
  error,
  onRetry,
  compact = false,
}: {
  error: FeedErrorState;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? styles.inlineError : styles.state}>
      <p role="alert">{error.message}</p>
      {error.retryable ? (
        <button type="button" onClick={onRetry}>
          تلاش دوباره
        </button>
      ) : null}
      {error.goToDiscovery ? <Link href="/">بازگشت به کشف</Link> : null}
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

function formatFreshness(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
