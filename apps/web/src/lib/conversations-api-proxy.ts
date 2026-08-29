import { conversationIdContract } from "@sevo/contracts/conversations/v1";

import { proxyJsonApiRequest } from "./json-api-proxy";

export function proxyConversationsRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v1/conversations",
    isAllowed: isConversationPath,
    responseHeaders: [
      "content-type",
      "retry-after",
      "x-correlation-id",
      "cache-control",
    ],
    noStore: true,
    forwardSearch: true,
  });
}

function isConversationPath(segments: readonly string[]) {
  if (segments.length === 0) return true;
  if (!conversationIdContract.safeParse(segments[0]).success) return false;
  return segments.length === 1 || (segments.length === 2 && segments[1] === "messages");
}
