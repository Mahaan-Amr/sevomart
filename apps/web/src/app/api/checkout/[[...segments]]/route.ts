import { proxyCheckoutRequest } from "../../../../lib/checkout-api-proxy";

type Context = { params: Promise<{ segments?: string[] }> };

async function proxy(request: Request, context: Context) {
  const { segments = [] } = await context.params;
  return proxyCheckoutRequest(request, segments);
}

export const GET = proxy;
export const POST = proxy;
