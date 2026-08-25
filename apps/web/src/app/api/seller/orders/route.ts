import { proxySellerOrdersRequest } from "../../../../lib/checkout-api-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxySellerOrdersRequest(request);
}
