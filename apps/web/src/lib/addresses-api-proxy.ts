import { proxyJsonApiRequest } from "./json-api-proxy";

export async function proxyAddressesRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v1/addresses",
    isAllowed,
    responseHeaders: ["content-type", "retry-after"],
    noStore: true,
  });
}

function isAllowed(segments: readonly string[]) {
  return (
    segments.length === 0 ||
    (segments.length === 1 && /^[0-9a-f-]{36}$/.test(segments[0] ?? ""))
  );
}
