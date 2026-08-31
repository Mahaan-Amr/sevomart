import { proxySellerOrderDeliveryRevealRequest } from "../../../../../../../lib/seller-buyers-api-proxy";

type Context = { params: Promise<{ orderId: string }> };

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  const { orderId } = await context.params;
  return proxySellerOrderDeliveryRevealRequest(request, orderId);
}
