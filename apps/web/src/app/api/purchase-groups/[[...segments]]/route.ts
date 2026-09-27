import { proxyJsonApiRequest } from "../../../../lib/json-api-proxy";

type Context = { params: Promise<{ segments?: string[] }> };

async function proxy(request: Request, context: Context) {
  const { segments = [] } = await context.params;
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v2/purchase-groups",
    isAllowed: (parts) =>
      parts.length === 0 ||
      (parts.length === 1 && /^[0-9a-f-]{36}$/.test(parts[0] ?? "")) ||
      (parts.length === 2 &&
        /^[0-9a-f-]{36}$/.test(parts[0] ?? "") &&
        parts[1] === "dev-payment"),
    responseHeaders: ["content-type", "retry-after", "x-correlation-id"],
    noStore: true,
  });
}

export const GET = proxy;
export const POST = proxy;
