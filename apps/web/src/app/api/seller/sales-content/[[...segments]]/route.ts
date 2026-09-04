import { proxySellerSalesContentRequest } from "../../../../../lib/seller-sales-content-api-proxy";

type Context = { params: Promise<{ segments?: string[] }> };

async function proxy(request: Request, context: Context) {
  const { segments = [] } = await context.params;
  return proxySellerSalesContentRequest(request, segments);
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
