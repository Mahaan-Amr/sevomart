type NewConversationContext =
  | { kind: "STORE"; storeId: string }
  | { kind: "PRODUCT"; storeId: string; productId: string }
  | { kind: "ORDER"; storeId: string; orderId: string };

export function newConversationHref(context: NewConversationContext, returnTo: string) {
  return `/conversations/new?${new URLSearchParams({
    kind: context.kind,
    storeId: context.storeId,
    ...(context.kind === "PRODUCT" ? { productId: context.productId } : {}),
    ...(context.kind === "ORDER" ? { orderId: context.orderId } : {}),
    returnTo,
  })}`;
}

export function conversationContextTitle(context: NewConversationContext) {
  switch (context.kind) {
    case "STORE":
      return "گفت‌وگو درباره فروشگاه";
    case "PRODUCT":
      return "گفت‌وگو درباره کالا";
    case "ORDER":
      return "گفت‌وگو درباره سفارش";
  }
}

export function conversationContextDescription(context: NewConversationContext) {
  switch (context.kind) {
    case "STORE":
      return "این رشته به فروشگاه انتخاب‌شده مربوط است.";
    case "PRODUCT":
      return "این رشته به کالای انتخاب‌شده مربوط است.";
    case "ORDER":
      return "این رشته به سفارش انتخاب‌شده مربوط است.";
  }
}

export function conversationContextKey(context: NewConversationContext) {
  switch (context.kind) {
    case "STORE":
      return `store:${context.storeId}`;
    case "PRODUCT":
      return `product:${context.storeId}:${context.productId}`;
    case "ORDER":
      return `order:${context.storeId}:${context.orderId}`;
  }
}

export function newProductConversationHref(
  storeSlug: string,
  productId: string,
  returnTo: string,
) {
  return `/conversations/new?${new URLSearchParams({
    kind: "PRODUCT",
    storeSlug,
    productId,
    returnTo,
  })}`;
}
