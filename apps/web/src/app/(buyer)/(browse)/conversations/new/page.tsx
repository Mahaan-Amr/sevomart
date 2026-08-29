import {
  conversationContextV1Contract,
  type ConversationContextV1,
} from "@sevo/contracts/conversations/v1";
import { publicStoreContract } from "@sevo/contracts/store/v1";

import { firstParameter, safeReturnPath } from "../../../../../lib/navigation";
import { newConversationHref } from "../../../../../lib/conversation-navigation";
import { OpenConversation } from "./open-conversation";
import styles from "./open-conversation.module.css";

type Query = {
  kind?: string | string[];
  storeId?: string | string[];
  storeSlug?: string | string[];
  productId?: string | string[];
  orderId?: string | string[];
  returnTo?: string | string[];
};

export default async function NewConversationPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const query = await searchParams;
  const context = await parseContext(query);
  const returnTo = safeReturnPath(firstParameter(query.returnTo), "/");
  if (!context) {
    return (
      <section className={styles.state} role="alert">
        <h1>شروع گفت‌وگو ممکن نیست</h1>
        <p>زمینه این گفت‌وگو کامل یا معتبر نیست.</p>
        <a href={returnTo}>بازگشت</a>
      </section>
    );
  }
  const resumePath = newConversationHref(context, returnTo);
  return (
    <OpenConversation context={context} returnTo={returnTo} resumePath={resumePath} />
  );
}

async function parseContext(query: Query): Promise<ConversationContextV1 | undefined> {
  const kind = firstParameter(query.kind);
  const storeId =
    firstParameter(query.storeId) ??
    (kind === "PRODUCT"
      ? await readPublishedStoreId(firstParameter(query.storeSlug))
      : undefined);
  const candidate =
    kind === "STORE"
      ? { kind, storeId }
      : kind === "PRODUCT"
        ? {
            kind,
            storeId,
            productId: firstParameter(query.productId),
          }
        : kind === "ORDER"
          ? {
              kind,
              storeId,
              orderId: firstParameter(query.orderId),
            }
          : undefined;
  const parsed = conversationContextV1Contract.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

async function readPublishedStoreId(slug: string | undefined) {
  if (!slug) return undefined;
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";
  try {
    const response = await fetch(
      `${apiBaseUrl}/v1/stores/${encodeURIComponent(slug)}`,
      {
        cache: "no-store",
        headers: { "x-correlation-id": crypto.randomUUID() },
      },
    );
    if (!response.ok) return undefined;
    const parsed = publicStoreContract.safeParse(await response.json());
    return parsed.success ? parsed.data.id : undefined;
  } catch {
    return undefined;
  }
}
