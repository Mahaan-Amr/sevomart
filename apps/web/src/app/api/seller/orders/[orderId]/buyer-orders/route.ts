import { proxySellerBuyerOrderHistoryRequest } from "../../../../../../lib/seller-buyers-api-proxy";

type Context = { params: Promise<{ orderId: string }> };

export async function GET(request: Request, context: Context) {
  const { orderId } = await context.params;
  return proxySellerBuyerOrderHistoryRequest(request, orderId);
}

export const dynamic = "force-dynamic";
