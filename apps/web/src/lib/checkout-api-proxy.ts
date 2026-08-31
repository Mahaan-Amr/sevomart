import { proxyJsonApiRequest } from "./json-api-proxy";

export function proxyCheckoutRequest(request: Request, segments: readonly string[]) {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v1/checkout",
    isAllowed: (parts) =>
      parts.length === 1 && ["options", "prepare"].includes(parts[0] ?? ""),
    responseHeaders: ["content-type", "retry-after", "x-correlation-id"],
    noStore: true,
  });
}

export function proxyOrdersRequest(request: Request, segments: readonly string[] = []) {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v1/orders",
    isAllowed: (parts) =>
      parts.length === 0 || (parts.length === 2 && parts[1] === "payment-attempts"),
    responseHeaders: ["content-type", "retry-after", "x-correlation-id"],
    noStore: true,
  });
}

export function proxyPaymentAttemptsRequest(
  request: Request,
  segments: readonly string[],
) {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v1/payment-attempts",
    isAllowed: (parts) => parts.length === 1,
    responseHeaders: ["content-type", "x-correlation-id"],
    noStore: true,
  });
}

export function proxySellerOrdersRequest(
  request: Request,
  segments: readonly string[] = [],
) {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v1/seller/orders",
    isAllowed: (parts) =>
      parts.length === 0 ||
      (parts.length === 2 &&
        ["direct-refund", "fulfillment"].includes(parts[1] ?? "")) ||
      (parts.length === 3 && parts[1] === "fulfillment" && parts[2] === "advance"),
    responseHeaders: ["content-type", "x-correlation-id"],
    noStore: true,
  });
}
