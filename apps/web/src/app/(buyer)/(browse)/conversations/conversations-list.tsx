"use client";

import {
  conversationThreadPageV1Contract,
  type ConversationThreadV1,
} from "@sevo/contracts/conversations/v1";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { conversationErrorPresentation } from "../../../../lib/conversation-errors";
import { conversationContextTitle } from "../../../../lib/conversation-navigation";
import { loginHref } from "../../../../lib/navigation";
import styles from "./conversations.module.css";

export function ConversationsList() {
  const [items, setItems] = useState<ConversationThreadV1[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState(() => conversationErrorPresentation(undefined));

  const load = useCallback(async (cursor?: string) => {
    setState("loading");
    try {
      const query = new URLSearchParams({ limit: "20", ...(cursor ? { cursor } : {}) });
      const response = await fetch(`/api/conversations?${query}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign(loginHref("/conversations", "/"));
        return;
      }
      const body: unknown = await response.json();
      const parsed = conversationThreadPageV1Contract.safeParse(body);
      if (!response.ok || !parsed.success) {
        const presentation = conversationErrorPresentation(body);
        setError(presentation);
        if (["INVALID_CURSOR", "CURSOR_EXPIRED"].includes(presentation.code)) {
          setNextCursor(undefined);
        }
        setState("error");
        return;
      }
      setItems((current) =>
        cursor ? [...current, ...parsed.data.items] : parsed.data.items,
      );
      setNextCursor(parsed.data.nextCursor);
      setState("ready");
    } catch {
      setError(conversationErrorPresentation(undefined));
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className={styles.page} aria-labelledby="conversations-title">
      <header className={styles.heading}>
        <p>ارتباط‌های قابل پیگیری</p>
        <h1 id="conversations-title">گفت‌وگوها</h1>
      </header>
      {state === "error" ? (
        <div className={styles.state} role="alert">
          <strong>گفت‌وگوها بارگیری نشدند.</strong>
          <p>{error.message}</p>
          <p>{error.nextStep}</p>
          <button type="button" onClick={() => void load()}>
            {["INVALID_CURSOR", "CURSOR_EXPIRED"].includes(error.code)
              ? "شروع دوباره فهرست"
              : "تلاش دوباره"}
          </button>
        </div>
      ) : items.length === 0 && state === "ready" ? (
        <div className={styles.state}>
          <strong>هنوز گفت‌وگویی ندارید.</strong>
          <p>از صفحه فروشگاه، کالا یا سفارش می‌توانید گفت‌وگو را شروع کنید.</p>
          <Link href="/">دیدن فروشگاه‌ها</Link>
        </div>
      ) : (
        <>
          <ul className={styles.list} aria-label="فهرست گفت‌وگوها">
            {items.map((thread) => (
              <li key={thread.conversationId}>
                <Link href={`/conversations/${thread.conversationId}`}>
                  <span>{conversationContextTitle(thread.context)}</span>
                  <time dateTime={thread.updatedAt}>
                    {formatDate(thread.updatedAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
          {nextCursor ? (
            <button
              className={styles.more}
              type="button"
              disabled={state === "loading"}
              onClick={() => void load(nextCursor)}
            >
              {state === "loading" ? "در حال دریافت…" : "گفت‌وگوهای بعدی"}
            </button>
          ) : null}
        </>
      )}
      {state === "loading" && items.length === 0 ? (
        <p className={styles.loading} role="status">
          در حال دریافت گفت‌وگوها…
        </p>
      ) : null}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
