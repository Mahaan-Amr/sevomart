import { platformAgentAuthV1Paths } from "@sevo/contracts/identity-access/v1";

import { proxyIdentityRequest } from "../../../../../../lib/identity-api-proxy";

export async function POST(request: Request) {
  return proxyIdentityRequest(request, platformAgentAuthV1Paths.requestOtp);
}
