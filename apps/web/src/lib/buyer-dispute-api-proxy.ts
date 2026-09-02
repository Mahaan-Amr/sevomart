import { proxyJsonApiRequest } from "./json-api-proxy";

export function proxyBuyerDisputeRequest(
  request: Request,
  segments: readonly string[] = [],
) {
  const mutation = request.method === "POST";
  return proxyJsonApiRequest(request, segments, {
    basePath: mutation ? "/v2/buyer/disputes" : "/v1/buyer/disputes",
    isAllowed: (parts) => (mutation ? parts.length === 0 : parts.length <= 1),
    responseHeaders: ["content-type", "x-correlation-id"],
    noStore: true,
    forwardSearch: !mutation,
  });
}
