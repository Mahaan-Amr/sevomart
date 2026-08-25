import { proxyOrdersRequest } from "../../../../../lib/checkout-api-proxy";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await context.params;
  return proxyOrdersRequest(request, [orderId, "payment-attempts"]);
}
