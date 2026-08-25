import { proxyIdentityRequest } from "../../../../lib/identity-api-proxy";

export function GET(request: Request) {
  return proxyIdentityRequest(request, "/v1/platform/payment-reviews");
}
