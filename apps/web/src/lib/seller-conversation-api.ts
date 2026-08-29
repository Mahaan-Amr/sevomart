import {
  conversationMessagePageV1Contract,
  conversationThreadPageV1Contract,
  conversationThreadV1Contract,
  type ConversationMessageV1,
  type ConversationThreadV1,
} from "@sevo/contracts/conversations/v1";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export type ConversationPage = {
  items: ConversationThreadV1[];
  nextCursor?: string;
};

export type ConversationMessagePage = {
  items: ConversationMessageV1[];
  nextCursor?: string;
};

export type SellerConversationRead<T> =
  | { kind: "OK"; data: T }
  | { kind: "NOT_FOUND_OR_FORBIDDEN" }
  | { kind: "UNAVAILABLE" };

export async function readSellerConversations(
  cookieHeader: string,
  cursor?: string,
  limit = 20,
): Promise<SellerConversationRead<ConversationPage>> {
  const search = new URLSearchParams({ limit: String(limit) });
  if (cursor) search.set("cursor", cursor);
  return readJson(
    `/v1/conversations?${search}`,
    cookieHeader,
    conversationThreadPageV1Contract,
  );
}

export async function readSellerConversation(
  cookieHeader: string,
  conversationId: string,
): Promise<SellerConversationRead<ConversationThreadV1>> {
  return readJson(
    `/v1/conversations/${encodeURIComponent(conversationId)}`,
    cookieHeader,
    conversationThreadV1Contract,
  );
}

export async function readSellerConversationMessages(
  cookieHeader: string,
  conversationId: string,
  cursor?: string,
  limit = 30,
): Promise<SellerConversationRead<ConversationMessagePage>> {
  const search = new URLSearchParams({ limit: String(limit) });
  if (cursor) search.set("cursor", cursor);
  return readJson(
    `/v1/conversations/${encodeURIComponent(conversationId)}/messages?${search}`,
    cookieHeader,
    conversationMessagePageV1Contract,
  );
}

export async function readNearestSellerConversation(
  cookieHeader: string,
): Promise<
  | { kind: "ACTIONABLE"; conversation: ConversationThreadV1 }
  | { kind: "NONE" }
  | { kind: "UNAVAILABLE" }
> {
  const conversations = await readSellerConversations(cookieHeader, undefined, 50);
  if (conversations.kind !== "OK") return { kind: "UNAVAILABLE" };
  if (conversations.data.items.length === 0) return { kind: "NONE" };

  const messagePages = await Promise.all(
    conversations.data.items.map((conversation) =>
      readSellerConversationMessages(
        cookieHeader,
        conversation.conversationId,
        undefined,
        1,
      ),
    ),
  );
  const actionableIndex = messagePages.findIndex(
    (page) => page.kind === "OK" && page.data.items[0]?.senderRole === "BUYER",
  );
  if (actionableIndex >= 0) {
    return {
      kind: "ACTIONABLE",
      conversation: conversations.data.items[actionableIndex]!,
    };
  }
  return messagePages.some((page) => page.kind === "UNAVAILABLE")
    ? { kind: "UNAVAILABLE" }
    : { kind: "NONE" };
}

async function readJson<T>(
  path: string,
  cookieHeader: string,
  contract: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<SellerConversationRead<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if ([403, 404, 410].includes(response.status)) {
      return { kind: "NOT_FOUND_OR_FORBIDDEN" };
    }
    if (!response.ok) return { kind: "UNAVAILABLE" };
    const parsed = contract.safeParse(await response.json());
    return parsed.success ? { kind: "OK", data: parsed.data } : { kind: "UNAVAILABLE" };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}
