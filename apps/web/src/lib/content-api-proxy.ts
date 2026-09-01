import { orderItemIdContract } from "@sevo/contracts/orders/v1";

import { proxyJsonApiRequest } from "./json-api-proxy";

export function proxyPurchaseExperiencesRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v2/purchase-experiences",
    isAllowed: (candidate) =>
      (request.method === "POST" && candidate.length === 0) ||
      (request.method === "GET" &&
        candidate.length === 2 &&
        candidate[0] === "eligibility" &&
        orderItemIdContract.safeParse(candidate[1]).success),
    responseHeaders: ["content-type", "retry-after", "x-correlation-id"],
    noStore: true,
  });
}
