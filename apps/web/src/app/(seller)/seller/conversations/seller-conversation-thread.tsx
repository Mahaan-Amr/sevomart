"use client";

import {
  conversationErrorV1Contract,
  conversationMessagePageV1Contract,
  conversationMessageV1Contract,
  type ConversationMessageContentV1,
  type ConversationMessageV1,
  type ConversationThreadV1,
} from "@sevo/contracts/conversations/v1";
import {
  MEDIA_UPLOAD_ACCEPTED_TYPES,
  MEDIA_UPLOAD_MAX_BYTES,
  mediaReferenceContract,
} from "@sevo/contracts/media/v1";
import { type FormEvent, useRef, useState } from "react";

import {
  failOutgoingMessage,
  retryOutgoingMessage,
  settleOutgoingMessage,
  startOutgoingMessage,
  type OptimisticConversationMessage,
  type VisibleConversationMessage,
} from "./conversation-composer-state";
import styles from "./conversations.module.css";

export function SellerConversationThread({
  conversation,
  initialMessages,
  initialNextCursor,
}: {
  conversation: ConversationThreadV1;
  initialMessages: ConversationMessageV1[];
  initialNextCursor?: string;
}) {
  const [messages, setMessages] = useState<VisibleConversationMessage[]>(
    [...initialMessages].reverse(),
  );
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (uploading) return;
    setNotice(undefined);
    let content: ConversationMessageContentV1;
    if (file) {
      const validation = validateAttachment(file);
      if (validation) {
        setNotice(validation);
        return;
      }
      setUploading(true);
      const uploaded = await uploadAttachment(conversation.conversationId, file);
      setUploading(false);
      if (!uploaded.ok) {
        setNotice(uploaded.message);
        return;
      }
      const caption = text.trim();
      content = {
        type: "MEDIA",
        mediaId: uploaded.mediaId,
        ...(caption ? { caption } : {}),
      };
    } else {
      const value = text.trim();
      if (!value) {
        setNotice("متن پیام را بنویسید یا یک تصویر انتخاب کنید.");
        return;
      }
      content = { type: "TEXT", text: value };
    }

    const outgoing = startOutgoingMessage({
      clientId: crypto.randomUUID(),
      conversationId: conversation.conversationId,
      idempotencyKey: crypto.randomUUID(),
      content,
    });
    setMessages((current) => [...current, outgoing]);
    setText("");
    setFile(undefined);
    if (fileInput.current) fileInput.current.value = "";
    await send(outgoing);
  }

  async function send(outgoing: OptimisticConversationMessage) {
    try {
      const response = await fetch(
        `/api/conversations/${conversation.conversationId}/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": outgoing.idempotencyKey,
          },
          body: JSON.stringify({ content: outgoing.content }),
        },
      );
      if (!response.ok) {
        const message = await responseMessage(response);
        setMessages((current) =>
          current.map((item) =>
            "clientId" in item && item.clientId === outgoing.clientId
              ? failOutgoingMessage(item, message)
              : item,
          ),
        );
        return;
      }
      const parsed = conversationMessageV1Contract.safeParse(await response.json());
      if (!parsed.success) throw new Error("invalid conversation response");
      setMessages((current) =>
        settleOutgoingMessage(current, outgoing.clientId, parsed.data),
      );
    } catch {
      setMessages((current) =>
        current.map((item) =>
          "clientId" in item && item.clientId === outgoing.clientId
            ? failOutgoingMessage(
                item,
                "پیام فرستاده نشد. اتصال را بررسی و با همان پیام دوباره تلاش کنید.",
              )
            : item,
        ),
      );
    }
  }

  async function retry(outgoing: OptimisticConversationMessage) {
    const retrying = retryOutgoingMessage(outgoing);
    setMessages((current) =>
      current.map((item) =>
        "clientId" in item && item.clientId === outgoing.clientId ? retrying : item,
      ),
    );
    await send(retrying);
  }

  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setNotice(undefined);
    try {
      const search = new URLSearchParams({ limit: "30", cursor: nextCursor });
      const response = await fetch(
        `/api/conversations/${conversation.conversationId}/messages?${search}`,
      );
      if (!response.ok) {
        setNotice(await responseMessage(response));
        return;
      }
      const parsed = conversationMessagePageV1Contract.safeParse(await response.json());
      if (!parsed.success) throw new Error("invalid message page");
      setMessages((current) => {
        const known = new Set(
          current.flatMap((item) => ("messageId" in item ? [item.messageId] : [])),
        );
        return [
          ...parsed.data.items.filter((item) => !known.has(item.messageId)).reverse(),
          ...current,
        ];
      });
      setNextCursor(parsed.data.nextCursor);
    } catch {
      setNotice("پیام‌های قدیمی‌تر دریافت نشد. دوباره تلاش کنید.");
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <>
      <div className={styles.messageRegion} aria-label="پیام‌های گفت‌وگو">
        {nextCursor ? (
          <button
            className={styles.loadOlder}
            type="button"
            onClick={loadOlder}
            disabled={loadingOlder}
          >
            {loadingOlder ? "در حال دریافت…" : "پیام‌های قدیمی‌تر"}
          </button>
        ) : null}
        {messages.length === 0 ? (
          <p className={styles.noMessages}>هنوز پیامی در این رشته ثبت نشده است.</p>
        ) : (
          <ol className={styles.messageList} aria-live="polite">
            {messages.map((message) => (
              <MessageItem
                key={"clientId" in message ? message.clientId : message.messageId}
                message={message}
                onRetry={retry}
              />
            ))}
          </ol>
        )}
      </div>

      <form className={styles.composer} onSubmit={submit}>
        <label htmlFor="seller-conversation-message">
          {file ? "توضیح کوتاه تصویر (اختیاری)" : "پاسخ شما"}
        </label>
        <textarea
          id="seller-conversation-message"
          value={text}
          maxLength={file ? 1_000 : 4_000}
          rows={3}
          onChange={(event) => setText(event.target.value)}
          placeholder="پاسخ روشن و کوتاه بنویسید…"
        />
        <div className={styles.composerActions}>
          <label className={styles.fileAction}>
            <span>{file ? "تغییر تصویر" : "افزودن تصویر"}</span>
            <input
              ref={fileInput}
              type="file"
              accept={MEDIA_UPLOAD_ACCEPTED_TYPES.join(",")}
              onChange={(event) => {
                setFile(event.target.files?.[0]);
                setNotice(undefined);
              }}
            />
          </label>
          {file ? (
            <button
              className={styles.removeFile}
              type="button"
              onClick={() => {
                setFile(undefined);
                if (fileInput.current) fileInput.current.value = "";
              }}
            >
              حذف تصویر
            </button>
          ) : null}
          <button className={styles.sendButton} type="submit" disabled={uploading}>
            {uploading ? "در حال آماده‌سازی…" : "فرستادن پاسخ"}
          </button>
        </div>
        {file ? <p className={styles.fileName}>تصویر انتخاب‌شده: {file.name}</p> : null}
        {notice ? (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        ) : null}
      </form>
    </>
  );
}

function MessageItem({
  message,
  onRetry,
}: {
  message: VisibleConversationMessage;
  onRetry: (message: OptimisticConversationMessage) => void;
}) {
  const optimistic = "clientId" in message;
  const own = optimistic || message.senderRole === "SELLER";
  return (
    <li className={own ? styles.ownMessage : styles.buyerMessage}>
      <span className={styles.sender}>{own ? "شما" : "خریدار"}</span>
      {message.content.type === "TEXT" ? (
        <p>{message.content.text}</p>
      ) : (
        <figure className={styles.attachment}>
          {/* Private media is served only after the API rechecks live thread access. */}
          <img
            src={`/api/conversation-media/${message.content.mediaId}`}
            alt={message.content.caption ?? "تصویر گفت‌وگو"}
          />
          {message.content.caption ? (
            <figcaption>{message.content.caption}</figcaption>
          ) : null}
        </figure>
      )}
      {optimistic ? (
        <div className={styles.deliveryState}>
          <span>
            {message.status === "SENDING" ? "در حال فرستادن…" : message.error}
          </span>
          {message.status === "UNSENT" ? (
            <button type="button" onClick={() => onRetry(message)}>
              تلاش دوباره
            </button>
          ) : null}
        </div>
      ) : (
        <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
      )}
    </li>
  );
}

async function uploadAttachment(conversationId: string, file: File) {
  try {
    const form = new FormData();
    form.set("file", file);
    const response = await fetch(`/api/conversations/${conversationId}/media`, {
      method: "POST",
      body: form,
    });
    if (!response.ok)
      return { ok: false as const, message: await responseMessage(response) };
    const parsed = mediaReferenceContract.safeParse(await response.json());
    return parsed.success
      ? { ok: true as const, mediaId: parsed.data.id }
      : { ok: false as const, message: "تصویر آماده نشد. دوباره تلاش کنید." };
  } catch {
    return { ok: false as const, message: "تصویر بارگذاری نشد. اتصال را بررسی کنید." };
  }
}

function validateAttachment(file: File) {
  if (!(MEDIA_UPLOAD_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "فقط تصویر JPEG، PNG یا WebP قابل فرستادن است.";
  }
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
    return "حجم تصویر باید حداکثر ۱۰ مگابایت باشد.";
  }
}

async function responseMessage(response: Response) {
  try {
    const parsed = conversationErrorV1Contract.safeParse(await response.json());
    if (!parsed.success) return fallbackForStatus(response.status);
    const messages: Partial<Record<typeof parsed.data.code, string>> = {
      FORBIDDEN_CONVERSATION:
        "این رشته به فروشگاه شما مربوط نیست یا دسترسی آن تغییر کرده است.",
      CONVERSATION_NOT_FOUND: "این رشته دیگر پیدا نشد. به فهرست گفت‌وگوها برگردید.",
      CONTEXT_UNAVAILABLE: "زمینه این گفت‌وگو دیگر در دسترس نیست.",
      MESSAGE_REJECTED: "پیام یا تصویر پذیرفته نشد. محتوا را بررسی کنید.",
      MEDIA_NOT_READY: "تصویر هنوز آماده نیست. کمی بعد با همین پیام تلاش کنید.",
      IDEMPOTENCY_IN_PROGRESS: "فرستادن پیام هنوز در حال بررسی است. کمی بعد تلاش کنید.",
      IDEMPOTENCY_CONFLICT: "این تلاش به پیام دیگری مربوط است. پیام را دوباره بنویسید.",
      CURSOR_EXPIRED: "زمان مرور پیام‌های قدیمی تمام شده است. صفحه را تازه کنید.",
    };
    return messages[parsed.data.code] ?? parsed.data.message;
  } catch {
    return fallbackForStatus(response.status);
  }
}

function fallbackForStatus(status: number) {
  if (status === 503) return "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.";
  if (status === 422) return "پیام یا تصویر پذیرفته نشد. محتوا را بررسی کنید.";
  if ([401, 403, 404].includes(status)) {
    return "این گفت‌وگو دیگر در دسترس شما نیست. به فهرست برگردید.";
  }
  return "درخواست انجام نشد. دسترسی و اطلاعات را بررسی کنید.";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}
