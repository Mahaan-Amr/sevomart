import { cookies } from "next/headers";
import Link from "next/link";

import { readSellerConversations } from "../../../../../lib/seller-conversation-api";
import { conversationContextLabel } from "../../conversations/conversation-copy";
import styles from "../../conversations/conversations.module.css";

export default async function SellerConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const cookieStore = await cookies();
  const { cursor } = await searchParams;
  const conversations = await readSellerConversations(cookieStore.toString(), cursor);

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="conversations-title">
        <div className={styles.headingRow}>
          <div>
            <span className={styles.eyebrow}>پیگیری خریدار</span>
            <h1 id="conversations-title">گفت‌وگوها</h1>
            <p>هر رشته فقط به فروشگاه و زمینه مجاز خودش مربوط است.</p>
          </div>
          <Link className={styles.backLink} href="/seller">
            بازگشت به خانه
          </Link>
        </div>

        {conversations.kind !== "OK" ? (
          <div className={styles.emptyState} role="status">
            <h2>گفت‌وگوها دریافت نشد</h2>
            <p>ارتباط برقرار نشد یا این صفحه دیگر معتبر نیست.</p>
            <Link className={styles.secondaryAction} href="/seller/conversations">
              بررسی دوباره
            </Link>
          </div>
        ) : conversations.data.items.length === 0 ? (
          <div className={styles.emptyState} role="status">
            <h2>هنوز گفت‌وگویی نیست</h2>
            <p>وقتی خریدار درباره فروشگاه، کالا یا سفارش پیام بدهد اینجا می‌آید.</p>
          </div>
        ) : (
          <>
            <ul className={styles.conversationList} aria-label="رشته‌های گفت‌وگو">
              {conversations.data.items.map((conversation) => (
                <li key={conversation.conversationId}>
                  <Link
                    className={styles.conversationLink}
                    href={`/seller/conversations/${conversation.conversationId}`}
                  >
                    <span className={styles.conversationTitle}>
                      {conversationContextLabel(conversation.context)}
                    </span>
                    <span className={styles.conversationMeta}>
                      آخرین فعالیت {formatDate(conversation.updatedAt)}
                    </span>
                    <span className={styles.openHint}>بازکردن رشته</span>
                  </Link>
                </li>
              ))}
            </ul>
            {conversations.data.nextCursor ? (
              <Link
                className={styles.secondaryAction}
                href={`/seller/conversations?cursor=${encodeURIComponent(conversations.data.nextCursor)}`}
              >
                گفت‌وگوهای قدیمی‌تر
              </Link>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}
