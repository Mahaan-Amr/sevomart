import type { ConversationContextV1 } from "@sevo/contracts/conversations/v1";

export function conversationContextLabel(context: ConversationContextV1) {
  if (context.kind === "ORDER") {
    return `سفارش ${shortId(context.orderId)}`;
  }
  if (context.kind === "PRODUCT") {
    return `کالا ${shortId(context.productId)}`;
  }
  return `فروشگاه ${shortId(context.storeId)}`;
}

function shortId(value: string) {
  return value.slice(0, 8).toLocaleUpperCase("fa-IR");
}
