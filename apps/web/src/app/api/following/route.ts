import {
  discoveryFeedCursorContract,
  discoveryV1Paths,
} from "@sevo/contracts/discovery/v1";

import { proxyJsonApiRequest } from "../../../lib/json-api-proxy";

export function GET(request: Request) {
  const cursor = new URL(request.url).searchParams.get("cursor");
  if (cursor !== null && !discoveryFeedCursorContract.safeParse(cursor).success) {
    return Response.json({ message: "نشانی ادامه فهرست معتبر نیست." }, { status: 400 });
  }
  const query = new URLSearchParams({ limit: "18", ...(cursor ? { cursor } : {}) });
  return proxyJsonApiRequest(request, [], {
    basePath: `${discoveryV1Paths.followingFeed}?${query}`,
    isAllowed: (segments) => segments.length === 0,
    responseHeaders: ["content-type", "retry-after", "x-correlation-id"],
    noStore: true,
  });
}
