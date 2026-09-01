import { proxyJsonApiRequest } from "./json-api-proxy";

export function proxyBuyerDisputeRequest(
  request: Request,
  segments: readonly string[] = [],
) {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v1/buyer/disputes",
    isAllowed: (parts) => parts.length <= 1,
    responseHeaders: ["content-type", "x-correlation-id"],
    noStore: true,
  });
}
