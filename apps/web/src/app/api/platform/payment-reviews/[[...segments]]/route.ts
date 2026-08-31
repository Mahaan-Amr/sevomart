import { proxyIdentityRequest } from "../../../../../lib/identity-api-proxy";

type Context = { params: Promise<{ segments?: string[] }> };

async function proxy(request: Request, context: Context) {
  const { segments = [] } = await context.params;
  const suffix = segments.length > 0 ? `/${segments.join("/")}` : "";
  return proxyIdentityRequest(request, `/v2/platform/payment-reviews${suffix}`);
}

export const POST = proxy;
export const GET = proxy;
