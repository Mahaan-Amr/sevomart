"use client";

import {
  conversationThreadV1Contract,
  type ConversationContextV1,
} from "@sevo/contracts/conversations/v1";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { conversationErrorPresentation } from "../../../../../lib/conversation-errors";
import { conversationContextKey } from "../../../../../lib/conversation-navigation";
import { loginHref } from "../../../../../lib/navigation";
import styles from "./open-conversation.module.css";

export function OpenConversation({
  context,
  returnTo,
  resumePath,
}: {
  context: ConversationContextV1;
  returnTo: string;
  resumePath: string;
}) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<"opening" | "error">("opening");
  const [error, setError] = useState(() => conversationErrorPresentation(undefined));

  const open = useCallback(async () => {
    setState("opening");
    const storageKey = `sevo:conversation-open:${conversationContextKey(context)}`;
    const idempotencyKey = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    sessionStorage.setItem(storageKey, idempotencyKey);
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ context }),
      });
      if (response.status === 401) {
        window.location.assign(loginHref(resumePath, returnTo));
        return;
      }
      const body: unknown = await response.json();
      const parsed = conversationThreadV1Contract.safeParse(body);
      if (!response.ok || !parsed.success) {
        setError(conversationErrorPresentation(body));
        setState("error");
        return;
      }
      sessionStorage.removeItem(storageKey);
      router.replace(`/conversations/${parsed.data.conversationId}`);
    } catch {
      setError(conversationErrorPresentation(undefined));
      setState("error");
    }
  }, [context, resumePath, returnTo, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open();
  }, [open]);

  return (
    <section className={styles.state} aria-live="polite">
      {state === "opening" ? (
        <>
          <h1>در حال بازکردن گفت‌وگو</h1>
          <p role="status">زمینه انتخاب‌شده را بررسی می‌کنیم.</p>
        </>
      ) : (
        <>
          <h1>گفت‌وگو باز نشد</h1>
          <p role="alert">{error.message}</p>
          <p>{error.nextStep}</p>
          <button type="button" onClick={() => void open()}>
            تلاش دوباره
          </button>
          <a href={returnTo}>بازگشت</a>
        </>
      )}
    </section>
  );
}
