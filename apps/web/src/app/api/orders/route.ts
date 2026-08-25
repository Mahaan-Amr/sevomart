import { proxyOrdersRequest } from "../../../lib/checkout-api-proxy";

export function POST(request: Request) {
  return proxyOrdersRequest(request);
}
