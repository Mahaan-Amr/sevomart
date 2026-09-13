import { contentIdContract } from "@sevo/contracts/content/v2";

import { proxyJsonApiRequest } from "./json-api-proxy";

export function proxySellerSalesContentRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v2/seller/sales-content",
    isAllowed: (candidate) =>
      (candidate.length === 0 && ["GET", "POST"].includes(request.method)) ||
      (candidate.length === 1 &&
        contentIdContract.safeParse(candidate[0]).success &&
        ["GET", "PUT"].includes(request.method)),
    responseHeaders: ["content-type", "retry-after", "x-correlation-id"],
    noStore: true,
  });
}
