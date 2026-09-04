import {
  contentV2Operations,
  publicSalesContentStoreIdsV2Contract,
} from "@sevo/contracts/content/v2";

import { proxyJsonApiRequest } from "../../../lib/json-api-proxy";

export function GET(request: Request) {
  const storeIds = new URL(request.url).searchParams.get("storeIds");
  if (!publicSalesContentStoreIdsV2Contract.safeParse(storeIds).success) {
    return Response.json(
      { message: "فروشگاه‌های این بخش معتبر نیستند." },
      { status: 400 },
    );
  }
  const query = new URLSearchParams({ storeIds: storeIds! });
  return proxyJsonApiRequest(request, [], {
    basePath: `${contentV2Operations.readPublicSalesContent.path}?${query}`,
    isAllowed: (segments) => segments.length === 0,
    responseHeaders: ["content-type", "x-correlation-id"],
    noStore: true,
  });
}
