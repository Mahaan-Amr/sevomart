import { disputeIdContract } from "@sevo/contracts/problem-follow-up/v1";

import { proxyJsonApiRequest } from "./json-api-proxy";

export function proxySellerDisputesRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  const isListRead = request.method === "GET" && segments.length === 0;
  const isDetailRead =
    request.method === "GET" &&
    segments.length === 1 &&
    disputeIdContract.safeParse(segments[0]).success;
  const isResponseWrite =
    request.method === "POST" &&
    segments.length === 2 &&
    disputeIdContract.safeParse(segments[0]).success &&
    segments[1] === "response";

  return proxyJsonApiRequest(request, segments, {
    basePath: isResponseWrite ? "/v2/seller/disputes" : "/v1/seller/disputes",
    isAllowed: () => isListRead || isDetailRead || isResponseWrite,
    responseHeaders: ["content-type", "retry-after"],
    noStore: true,
    forwardSearch: isListRead,
  });
}
