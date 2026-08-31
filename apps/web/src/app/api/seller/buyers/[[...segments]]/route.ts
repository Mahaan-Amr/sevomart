import { proxySellerBuyersRequest } from "../../../../../lib/seller-buyers-api-proxy";

type Context = { params: Promise<{ segments?: string[] }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const { segments = [] } = await context.params;
  return proxySellerBuyersRequest(request, segments);
}
