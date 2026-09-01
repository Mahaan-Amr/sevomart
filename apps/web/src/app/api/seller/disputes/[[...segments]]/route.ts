import { proxySellerDisputesRequest } from "../../../../../lib/seller-dispute-api-proxy";

type Context = { params: Promise<{ segments?: string[] }> };

async function proxy(request: Request, context: Context) {
  const { segments = [] } = await context.params;
  return proxySellerDisputesRequest(request, segments);
}

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
