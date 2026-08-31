import { proxyJsonApiRequest } from "./json-api-proxy";

export function proxySellerBuyersRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v1/seller/buyers",
    isAllowed: (pathSegments) => pathSegments.length === 0,
    responseHeaders: ["content-type", "x-correlation-id"],
    noStore: true,
    forwardSearch: true,
  });
}

export function proxySellerOrderDeliveryRevealRequest(
  request: Request,
  orderId: string,
): Promise<Response> {
  return proxyJsonApiRequest(request, [orderId, "delivery-details", "reveal"], {
    basePath: "/v1/seller/orders",
    isAllowed: (segments) =>
      segments.length === 3 &&
      segments[0] === orderId &&
      segments[1] === "delivery-details" &&
      segments[2] === "reveal",
    responseHeaders: ["content-type", "x-correlation-id"],
    noStore: true,
  });
}
