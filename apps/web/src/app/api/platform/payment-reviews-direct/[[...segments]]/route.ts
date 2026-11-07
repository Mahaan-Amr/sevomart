import { proxyIdentityRequest } from "../../../../../lib/identity-api-proxy";
type Context = { params: Promise<{ segments?: string[] }> };
async function proxy(request: Request, context: Context) {
  const { segments = [] } = await context.params;
  return proxyIdentityRequest(
    request,
    `/v3/platform/payment-reviews${segments.length ? `/${segments.join("/")}` : ""}`,
  );
}
export const POST = proxy;
