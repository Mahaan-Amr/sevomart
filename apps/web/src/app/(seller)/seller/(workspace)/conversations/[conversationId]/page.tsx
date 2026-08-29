import { cookies } from "next/headers";
import Link from "next/link";

import {
  readSellerConversation,
  readSellerConversationMessages,
} from "../../../../../../lib/seller-conversation-api";
import { conversationContextLabel } from "../../../conversations/conversation-copy";
import { SellerConversationThread } from "../../../conversations/seller-conversation-thread";
import styles from "../../../conversations/conversations.module.css";

export default async function SellerConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const [conversation, messages] = await Promise.all([
    readSellerConversation(cookieHeader, conversationId),
    readSellerConversationMessages(cookieHeader, conversationId),
  ]);

  if (conversation.kind !== "OK" || messages.kind !== "OK") {
    const unavailable =
      conversation.kind === "UNAVAILABLE" || messages.kind === "UNAVAILABLE";
    return (
      <main className={styles.page}>
        <section
          className={styles.workspace}
          aria-labelledby="conversation-error-title"
        >
          <span className={styles.eyebrow}>گفت‌وگو</span>
          <h1 id="conversation-error-title">
            {unavailable ? "رشته دریافت نشد" : "این گفت‌وگو در دسترس نیست"}
          </h1>
          <p>
            {unavailable
              ? "ارتباط برقرار نشد. کمی بعد دوباره بررسی کنید."
              : "ممکن است رشته به فروشگاه دیگری مربوط باشد یا زمینه آن دیگر در دسترس نباشد."}
          </p>
          <Link className={styles.secondaryAction} href="/seller/conversations">
            بازگشت به فهرست گفت‌وگوها
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.threadPage}>
      <section className={styles.threadWorkspace} aria-labelledby="conversation-title">
        <header className={styles.threadHeader}>
          <div>
            <span className={styles.eyebrow}>گفت‌وگوی خصوصی</span>
            <h1 id="conversation-title">
              {conversationContextLabel(conversation.data.context)}
            </h1>
            <p>پاسخ فقط در همین زمینه ثبت می‌شود.</p>
          </div>
          <Link className={styles.backLink} href="/seller/conversations">
            بازگشت به فهرست
          </Link>
        </header>
        <SellerConversationThread
          conversation={conversation.data}
          initialMessages={messages.data.items}
          initialNextCursor={messages.data.nextCursor}
        />
      </section>
    </main>
  );
}
