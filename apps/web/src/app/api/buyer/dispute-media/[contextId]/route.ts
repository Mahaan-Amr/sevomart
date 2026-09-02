import { proxyJsonApiRequest } from "../../../../../lib/json-api-proxy";

type Context = { params: Promise<{ contextId: string }> };

export async function POST(request: Request, context: Context) {
  const { contextId } = await context.params;
  return proxyJsonApiRequest(request, [contextId], {
    basePath: "/v1/buyer-dispute-media",
    isAllowed: (segments) =>
      segments.length === 1 && /^[0-9a-f-]{36}$/i.test(segments[0] ?? ""),
    responseHeaders: ["content-type", "x-correlation-id"],
    noStore: true,
  });
}
