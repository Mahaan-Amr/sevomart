import { proxyOrdersRequest } from "../../../lib/checkout-api-proxy";

export function POST(request: Request) {
  return proxyOrdersRequest(request);
}

export function GET(request: Request) {
  return proxyOrdersRequest(request);
}
