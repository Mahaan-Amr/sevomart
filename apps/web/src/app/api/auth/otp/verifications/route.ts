import { proxyIdentityRequest } from "../../../../../lib/identity-api-proxy";

export async function POST(request: Request) {
  return proxyIdentityRequest(request, "/v1/auth/otp/verifications", true);
}
