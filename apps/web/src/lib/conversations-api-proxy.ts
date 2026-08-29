import { conversationIdContract } from "@sevo/contracts/conversations/v1";

import { proxyJsonApiRequest } from "./json-api-proxy";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  });
}

export function proxyConversationMediaRequest(request: Request, mediaId: string) {
  return proxyJsonApiRequest(request, [mediaId], {
    basePath: "/v1/media",
    isAllowed: (parts) => parts.length === 1 && UUID_PATTERN.test(parts[0] ?? ""),
    responseHeaders: ["content-type", "x-correlation-id", "cache-control"],
    noStore: true,
  });
}

function isConversationPath(segments: readonly string[]) {
  if (segments.length === 0) return true;
  if (!conversationIdContract.safeParse(segments[0]).success) return false;
  return (
    segments.length === 1 ||
    (segments.length === 2 && ["messages", "media"].includes(segments[1] ?? ""))
  );
}
