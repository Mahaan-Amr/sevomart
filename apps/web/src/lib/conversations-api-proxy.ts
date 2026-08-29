import { conversationIdContract } from "@sevo/contracts/conversations/v1";
import { mediaIdContract } from "@sevo/contracts/media/v1";

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

export function proxyConversationMediaRequest(
  request: Request,
  mediaId: string,
): Promise<Response> {
  return proxyJsonApiRequest(request, [mediaId], {
    basePath: "/v1/media",
    isAllowed: (segments) =>
      segments.length === 1 && mediaIdContract.safeParse(segments[0]).success,
    responseHeaders: ["content-type", "x-correlation-id", "cache-control"],
    noStore: true,
  });
}

function isConversationPath(segments: readonly string[]) {
  if (segments.length === 0) return true;
  if (segments.length === 1 && segments[0] === "needs-reply") return true;
  if (!conversationIdContract.safeParse(segments[0]).success) return false;
  return (
    segments.length === 1 ||
    (segments.length === 2 && ["messages", "media"].includes(segments[1] ?? ""))
  );
}
