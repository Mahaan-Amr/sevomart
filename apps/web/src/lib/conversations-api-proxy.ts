import { proxyJsonApiRequest } from "./json-api-proxy";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function proxyConversationsRequest(
  request: Request,
  segments: readonly string[],
) {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v1/conversations",
    isAllowed: (parts) =>
      parts.length === 0 ||
      (parts.length === 1 && UUID_PATTERN.test(parts[0] ?? "")) ||
      (parts.length === 2 &&
        UUID_PATTERN.test(parts[0] ?? "") &&
        ["messages", "media"].includes(parts[1] ?? "")),
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
