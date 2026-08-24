"use client";

import {
  storeFollowViewV1Contract,
  type PublicFollowerCountV1,
  type ViewerStoreFollowV1,
} from "@sevo/contracts/discovery/v1";
import { useEffect, useRef, useState } from "react";

import styles from "./storefront.module.css";

type Operation = "ACTIVATE" | "DEACTIVATE";
type PendingWrite = { operation: Operation; idempotencyKey: string };

export function StoreFollowControl({
  storeId,
  slug,
  initialCount,
  initialViewer,
  autoFollow,
}: {
  storeId: string;
  slug: string;
  initialCount: PublicFollowerCountV1;
  initialViewer?: ViewerStoreFollowV1;
  autoFollow: boolean;
}) {
  const [count, setCount] = useState(initialCount.count);
  const [countUpdatedAt, setCountUpdatedAt] = useState(initialCount.updatedAt);
  const [viewer, setViewer] = useState(initialViewer);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [conflicted, setConflicted] = useState(false);
  const pendingWrite = useRef<PendingWrite | undefined>(undefined);
  const autoFollowStarted = useRef(false);
  const isFollowing = viewer?.isFollowing ?? false;
  const storePath = `/s/${encodeURIComponent(slug)}`;

  useEffect(() => {
    const savedScroll = sessionStorage.getItem(scrollStorageKey(storePath));
    if (savedScroll) {
      sessionStorage.removeItem(scrollStorageKey(storePath));
      requestAnimationFrame(() => window.scrollTo({ top: Number(savedScroll) }));
    }
  }, [storePath]);

  useEffect(() => {
    if (!autoFollow || !viewer || autoFollowStarted.current) return;
    autoFollowStarted.current = true;
    if (viewer.isFollowing) {
      clearFollowIntent();
      return;
    }
    void write("ACTIVATE");
  }, [autoFollow, viewer]);

  function requestChange() {
    if (!viewer) {
      redirectToLogin();
      return;
    }
    void write(isFollowing ? "DEACTIVATE" : "ACTIVATE");
  }

  async function write(operation: Operation) {
    setPending(true);
    setMessage("");
    setConflicted(false);
    const existing = pendingWrite.current;
    const request =
      existing?.operation === operation
        ? existing
        : { operation, idempotencyKey: crypto.randomUUID() };
    pendingWrite.current = request;
    try {
      const headers = new Headers({ "idempotency-key": request.idempotencyKey });
      if (viewer?.revision !== undefined) {
        headers.set("if-match", `"${viewer.revision}"`);
      }
      const response = await fetch(`/api/store/me/follows/${storeId}`, {
        method: operation === "ACTIVATE" ? "PUT" : "DELETE",
        headers,
      });
      const body: unknown = await response.json();
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) {
        setMessage(humanError(body));
        setConflicted(response.status === 409 || response.status === 428);
        return;
      }
      const parsed = storeFollowViewV1Contract.safeParse(body);
      if (!parsed.success) throw new Error("invalid follow response");
      const nextFollowing = parsed.data.status === "ACTIVE";
      if (nextFollowing !== isFollowing) {
        setCount((current) => Math.max(0, current + (nextFollowing ? 1 : -1)));
        setCountUpdatedAt(
          nextFollowing
            ? parsed.data.activatedAt
            : (parsed.data.deactivatedAt ?? parsed.data.activatedAt),
        );
      }
      setViewer({ isFollowing: nextFollowing, revision: parsed.data.revision });
      pendingWrite.current = undefined;
      clearFollowIntent();
    } catch {
      setMessage("ارتباط با سرور برقرار نشد.");
    } finally {
      setPending(false);
    }
  }

  function clearFollowIntent() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("follow")) return;
    url.searchParams.delete("follow");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function redirectToLogin() {
    const current = new URL(window.location.href);
    const cancelTo = `${current.pathname}${current.search}${current.hash}`;
    current.searchParams.set("follow", "1");
    const returnTo = `${current.pathname}${current.search}${current.hash}`;
    sessionStorage.setItem(scrollStorageKey(storePath), String(window.scrollY));
    window.location.assign(
      `/login?returnTo=${encodeURIComponent(returnTo)}&cancelTo=${encodeURIComponent(cancelTo)}`,
    );
  }

  return (
    <section className={styles.follow} aria-label="دنبال‌کردن فروشگاه">
      <div className={styles.followSummary}>
        <strong>{new Intl.NumberFormat("fa-IR").format(count)} دنبال‌کننده</strong>
        <time dateTime={countUpdatedAt}>
          به‌روزرسانی تا{" "}
          {new Intl.DateTimeFormat("fa-IR", { dateStyle: "short" }).format(
            new Date(countUpdatedAt),
          )}
        </time>
      </div>
      <button
        type="button"
        className={isFollowing ? styles.followingButton : styles.followButton}
        aria-pressed={isFollowing}
        aria-label={isFollowing ? "لغو دنبال‌کردن فروشگاه" : "دنبال‌کردن فروشگاه"}
        disabled={pending}
        onClick={requestChange}
      >
        {pending ? "در حال انجام…" : isFollowing ? "دنبال می‌کنید" : "دنبال‌کردن"}
      </button>
      {message ? (
        <div className={styles.followError} role="alert">
          <span>{message}</span>
          <button
            type="button"
            onClick={() =>
              conflicted
                ? window.location.reload()
                : void write(pendingWrite.current?.operation ?? "ACTIVATE")
            }
          >
            {conflicted ? "تازه‌کردن وضعیت" : "تلاش دوباره"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function scrollStorageKey(storePath: string) {
  return `sevo:store-return:${storePath}`;
}

function humanError(body: unknown) {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "درخواست انجام نشد. دوباره تلاش کنید.";
}
