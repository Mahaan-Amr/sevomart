import { proxyIdentityRequest } from "../../../../../../lib/identity-api-proxy";
export async function POST(request: Request) {
  return proxyIdentityRequest(request, "/v2/platform/auth/password/recovery-requests");
}
