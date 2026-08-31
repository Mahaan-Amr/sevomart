import { proxyIdentityRequest } from "../../../../../lib/identity-api-proxy";

type Context = { params: Promise<{ segments?: string[] }> };

export async function GET(request: Request, context: Context) {
  const { segments = [] } = await context.params;
  const suffix = segments.length > 0 ? `/${segments.join("/")}` : "";
  return proxyIdentityRequest(request, `/v1/platform/violations${suffix}`);
}
