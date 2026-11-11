"use client";

import {
  discoveryFeedPageV1Contract,
  discoveryFollowingFeedPageV1Contract,
  type DiscoveryFeedItemV1,
} from "@sevo/contracts/discovery/v1";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { BuyerProductCard } from "../_components/buyer-product-card";
import { formatIrrAsToman } from "../../../lib/format-money";
import { loginHref } from "../../../lib/navigation";
import { classifyFeedError, cursorNotice, type FeedErrorState } from "./feed-errors";
import { appendFeedPage, emptyFeedState, replaceFeedPage } from "./feed-state";
import { type FeedKind, useFeedWorkspace } from "./feed-workspace";
import styles from "./discovery.module.css";

type FeedViewProps = {
  kind: FeedKind;
  initialCursor?: string;
  showSellerInvitation?: boolean;
  layout?: "grid" | "home";
};

export function FeedView({
  kind,
  initialCursor,
  showSellerInvitation = false,
  layout = "grid",
}: FeedViewProps) {
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
          window.location.assign(loginHref("/following", "/discover"));
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

  useEffect(
    () => () => {
      request.current?.abort();
      started.current = false;
    },
    [],
  );

  if (!restored || (!state.snapshotAt && pending))
    return <FeedLoading layout={layout} />;

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
        <FeedGrid
          items={state.items}
          kind={kind}
          onLeave={saveForBrowse}
          layout={layout}
        />
      ) : null}
      {state.emptyState ? (
        <div className={styles.state}>
          <span className={styles.emptyMark} aria-hidden="true">
            سوو
          </span>
          <p>{state.emptyState.message}</p>
          {kind === "following" ? (
            <Link href="/discover">{state.emptyState.nextAction}</Link>
          ) : (
            <>
              <p>{state.emptyState.nextAction}</p>
              {showSellerInvitation ? (
                <Link href="/seller/start">فروشنده شوید</Link>
              ) : null}
            </>
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
  layout,
}: {
  items: DiscoveryFeedItemV1[];
  kind: FeedKind;
  onLeave: (kind: FeedKind, scrollY: number, focusTarget: string) => void;
  layout: "grid" | "home";
}) {
  return (
    <ul
      className={layout === "home" ? styles.homeFeed : styles.grid}
      aria-label="کالاهای تازه"
    >
      {items.map((item) => {
        const imageFocus = `${item.productId}:image`;
        const titleFocus = `${item.productId}:title`;
        const storeFocus = `${item.productId}:store`;
        const detailFocus = `${item.productId}:detail`;
        const rememberOrigin = (focusTarget: string) =>
          onLeave(kind, window.scrollY, focusTarget);
        return (
          <li key={item.productId}>
            {layout === "home" ? (
              <article className={styles.homePost}>
                <Link
                  className={styles.homeStore}
                  href={`/s/${item.storeSlug}`}
                  data-feed-focus={storeFocus}
                  onNavigate={() => rememberOrigin(storeFocus)}
                >
                  <span className={styles.homeAvatar} aria-hidden="true">
                    {item.store.logo ? (
                      <img src={`/api/store/media/${item.store.logo.id}`} alt="" />
                    ) : (
                      Array.from(item.store.name)[0]
                    )}
                  </span>
                  <strong>{item.store.name}</strong>
                </Link>
                <Link
                  className={styles.homeImage}
                  href={`/s/${item.storeSlug}/products/${item.productId}`}
                  aria-label={`دیدن ${item.product.name} و گزینه‌های آن`}
                  data-feed-focus={imageFocus}
                  onNavigate={() => rememberOrigin(imageFocus)}
                >
                  <img
                    src={`/api/store/media/${item.product.image.id}`}
                    alt=""
                    width={640}
                    height={640}
                  />
                </Link>
                <div className={styles.homePostDetails}>
                  <h2>
                    <Link
                      href={`/s/${item.storeSlug}/products/${item.productId}`}
                      data-feed-focus={titleFocus}
                      onNavigate={() => rememberOrigin(titleFocus)}
                    >
                      {item.product.name}
                    </Link>
                  </h2>
                  <p>
                    <strong>
                      {item.priceRange.minimum.amount !== item.priceRange.maximum.amount
                        ? "از "
                        : ""}
                      {formatIrrAsToman(item.priceRange.minimum.amount)}
                    </strong>
                    {item.availability === "OUT_OF_STOCK" ? <span>ناموجود</span> : null}
                  </p>
                  <Link
                    className={styles.homeProductLink}
                    href={`/s/${item.storeSlug}/products/${item.productId}`}
                    data-feed-focus={detailFocus}
                    onNavigate={() => rememberOrigin(detailFocus)}
                  >
                    دیدن کالا
                  </Link>
                </div>
              </article>
            ) : (
              <BuyerProductCard
                href={`/s/${item.storeSlug}/products/${item.productId}`}
                imageId={item.product.image.id}
                name={item.product.name}
                price={`${item.priceRange.minimum.amount !== item.priceRange.maximum.amount ? "از " : ""}${formatIrrAsToman(item.priceRange.minimum.amount)}`}
                unavailable={item.availability === "OUT_OF_STOCK"}
                store={{ name: item.store.name, href: `/s/${item.storeSlug}` }}
                focusPrefix={item.productId}
                onNavigate={(target) =>
                  rememberOrigin(
                    target === "image"
                      ? imageFocus
                      : target === "title"
                        ? titleFocus
                        : storeFocus,
                  )
                }
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FeedLoading({ layout }: { layout: "grid" | "home" }) {
  return (
    <section className={styles.loading} aria-label="در حال دریافت کالاها">
      <p role="status">در حال دریافت کالاها…</p>
      <div
        className={layout === "home" ? styles.homeLoading : styles.loadingGrid}
        aria-hidden="true"
      >
        {Array.from({ length: layout === "home" ? 2 : 18 }, (_, index) => (
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
      {error.goToDiscovery ? <Link href="/discover">بازگشت به کشف</Link> : null}
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
