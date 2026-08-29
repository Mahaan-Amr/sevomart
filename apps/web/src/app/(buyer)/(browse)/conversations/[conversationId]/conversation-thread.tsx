"use client";

import {
  conversationMessagePageV1Contract,
  conversationMessageV1Contract,
  conversationIdContract,
  conversationThreadV1Contract,
  type ConversationMessageContentV1,
  type ConversationOutgoingMessageV1,
  type ConversationThreadV1,
} from "@sevo/contracts/conversations/v1";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  conversationErrorPresentation,
  type ConversationErrorPresentation,
} from "../../../../../lib/conversation-errors";
import {
  conversationContextDescription,
  conversationContextTitle,
} from "../../../../../lib/conversation-navigation";
import { loginHref } from "../../../../../lib/navigation";
import styles from "./conversation-thread.module.css";

type LocalConversationMessage = ConversationOutgoingMessageV1 & {
  failure?: ConversationErrorPresentation;
};

export function ConversationThread({ conversationId }: { conversationId: string }) {
  const [thread, setThread] = useState<ConversationThreadV1>();
  const [messages, setMessages] = useState<LocalConversationMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(() => conversationErrorPresentation(undefined));
  const returnPath = `/conversations/${conversationId}`;

  const requireLogin = useCallback(() => {
    window.location.assign(loginHref(returnPath, "/conversations"));
  }, [returnPath]);

  const load = useCallback(
    async (cursor?: string) => {
      if (!cursor) setState("loading");
      try {
        const query = new URLSearchParams({
          limit: "30",
          ...(cursor ? { cursor } : {}),
        });
        const [threadResponse, messagesResponse] = await Promise.all([
          cursor
            ? undefined
            : fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
                cache: "no-store",
              }),
          fetch(
            `/api/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
            { cache: "no-store" },
          ),
        ]);
        if (threadResponse?.status === 401 || messagesResponse.status === 401) {
          requireLogin();
          return;
        }
        const threadBody: unknown = threadResponse
          ? await threadResponse.json()
          : undefined;
        const messagesBody: unknown = await messagesResponse.json();
        const parsedThread = threadResponse
          ? conversationThreadV1Contract.safeParse(threadBody)
          : undefined;
        const parsedMessages =
          conversationMessagePageV1Contract.safeParse(messagesBody);
        if (
          (threadResponse && (!threadResponse.ok || !parsedThread?.success)) ||
          !messagesResponse.ok ||
          !parsedMessages.success
        ) {
          const presentation = conversationErrorPresentation(
            threadResponse && !threadResponse.ok ? threadBody : messagesBody,
          );
          setError(presentation);
          if (["INVALID_CURSOR", "CURSOR_EXPIRED"].includes(presentation.code)) {
            setNextCursor(undefined);
          }
          setState("error");
          return;
        }
        if (parsedThread?.success) setThread(parsedThread.data);
        setMessages((current) =>
          cursor
            ? [...current, ...parsedMessages.data.items]
            : parsedMessages.data.items,
        );
        setNextCursor(parsedMessages.data.nextCursor);
        setState("ready");
      } catch {
        setError(conversationErrorPresentation(undefined));
        setState("error");
      }
    },
    [conversationId, requireLogin],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    await send({ type: "TEXT", text }, crypto.randomUUID());
  }

  async function send(
    content: ConversationMessageContentV1,
    idempotencyKey: string,
    retry = false,
  ) {
    setSending(true);
    const parsedConversationId = conversationIdContract.safeParse(conversationId);
    if (!parsedConversationId.success) {
      setState("error");
      setSending(false);
      return;
    }
    const unsent: ConversationOutgoingMessageV1 = {
      version: 1,
      conversationId: parsedConversationId.data,
      status: "UNSENT",
      idempotencyKey,
      content,
      retryable: true,
    };
    if (retry) {
      setMessages((current) =>
        current.map((message) =>
          message.status === "UNSENT" && message.idempotencyKey === idempotencyKey
            ? { ...message, failure: undefined }
            : message,
        ),
      );
    } else {
      setMessages((current) => [unsent, ...current]);
    }
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({ content }),
        },
      );
      if (response.status === 401) {
        requireLogin();
        return;
      }
      const body: unknown = await response.json();
      const parsed = conversationMessageV1Contract.safeParse(body);
      if (!response.ok || !parsed.success) {
        markUnsentFailure(idempotencyKey, conversationErrorPresentation(body));
        return;
      }
      setMessages((current) =>
        current.map((message) =>
          message.status === "UNSENT" && message.idempotencyKey === idempotencyKey
            ? parsed.data
            : message,
        ),
      );
    } catch {
      markUnsentFailure(idempotencyKey, conversationErrorPresentation(undefined));
    } finally {
      setSending(false);
    }
  }

  function markUnsentFailure(
    idempotencyKey: string,
    failure: ConversationErrorPresentation,
  ) {
    setMessages((current) =>
      current.map((message) =>
        message.status === "UNSENT" && message.idempotencyKey === idempotencyKey
          ? { ...message, failure }
          : message,
      ),
    );
  }

  function editUnsent(
    message: Extract<LocalConversationMessage, { status: "UNSENT" }>,
  ) {
    if (message.content.type === "TEXT") setDraft(message.content.text);
    setMessages((current) => current.filter((item) => item !== message));
  }

  const displayMessages = useMemo(() => [...messages].reverse(), [messages]);

  if (state === "loading") return <p role="status">در حال دریافت گفت‌وگو…</p>;
  if (state === "error" || !thread) {
    return (
      <section className={styles.state} role="alert">
        <h1>گفت‌وگو باز نشد</h1>
        <p>{error.message}</p>
        <p>{error.nextStep}</p>
        <button type="button" onClick={() => void load()}>
          تلاش دوباره
        </button>
        <Link href="/conversations">بازگشت به گفت‌وگوها</Link>
      </section>
    );
  }

  return (
    <section className={styles.page} aria-labelledby="thread-title">
      <header className={styles.heading}>
        <Link href="/conversations">بازگشت به گفت‌وگوها</Link>
        <h1 id="thread-title">{conversationContextTitle(thread.context)}</h1>
        <p>{conversationContextDescription(thread.context)}</p>
      </header>
      {nextCursor ? (
        <button
          className={styles.older}
          type="button"
          onClick={() => void load(nextCursor)}
        >
          پیام‌های قدیمی‌تر
        </button>
      ) : null}
      <ol className={styles.messages} aria-label="پیام‌های گفت‌وگو">
        {displayMessages.map((message) => {
          const key =
            message.status === "UNSENT" ? message.idempotencyKey : message.messageId;
          const own =
            message.status === "UNSENT" || message.senderRole === thread.viewerRole;
          return (
            <li key={key} className={own ? styles.own : styles.theirs}>
              <p>{messageText(message.content)}</p>
              {message.status === "UNSENT" ? (
                <div role="alert">
                  {message.failure ? (
                    <>
                      <span>پیام فرستاده نشد.</span>
                      <span>{message.failure.message}</span>
                      <span>{message.failure.nextStep}</span>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() =>
                          message.failure?.code === "MESSAGE_REJECTED"
                            ? editUnsent(message)
                            : void send(message.content, message.idempotencyKey, true)
                        }
                      >
                        {message.failure.code === "MESSAGE_REJECTED"
                          ? "ویرایش پیام"
                          : "تلاش دوباره برای ارسال"}
                      </button>
                    </>
                  ) : (
                    <span role="status">در حال فرستادن پیام…</span>
                  )}
                </div>
              ) : (
                <time dateTime={message.createdAt}>
                  {formatTime(message.createdAt)}
                </time>
              )}
            </li>
          );
        })}
      </ol>
      {messages.length === 0 ? (
        <p className={styles.empty}>هنوز پیامی در این گفت‌وگو نیست.</p>
      ) : null}
      <form className={styles.composer} onSubmit={submit}>
        <label htmlFor="conversation-message">پیام</label>
        <textarea
          id="conversation-message"
          maxLength={4_000}
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <small>{new Intl.NumberFormat("fa-IR").format(draft.length)} از ۴٬۰۰۰</small>
        <button type="submit" disabled={sending || !draft.trim()}>
          {sending ? "در حال فرستادن…" : "فرستادن پیام"}
        </button>
      </form>
    </section>
  );
}

function messageText(content: ConversationMessageContentV1) {
  if (content.type === "TEXT") return content.text;
  return content.caption ?? "رسانه فرستاده شد.";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
