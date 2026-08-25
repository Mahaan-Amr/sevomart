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

export function proxyOrdersRequest(request: Request) {
  return proxyJsonApiRequest(request, [], {
    basePath: "/v1/orders",
    isAllowed: (parts) => parts.length === 0,
    responseHeaders: ["content-type", "retry-after", "x-correlation-id"],
    noStore: true,
  });
}
