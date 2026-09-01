import { proxyJsonApiRequest } from "./json-api-proxy";

export async function proxySellerInventoryRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v1/seller/inventory",
    isAllowed: (pathSegments) => pathSegments.length === 0,
    responseHeaders: ["content-type", "retry-after"],
    noStore: true,
    forwardSearch: true,
  });
}
