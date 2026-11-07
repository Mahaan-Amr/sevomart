import { platformAgentAuthV2Paths } from "@sevo/contracts/identity-access/v2";

import { proxyIdentityRequest } from "../../../../../../lib/identity-api-proxy";

export async function POST(request: Request) {
  return proxyIdentityRequest(request, platformAgentAuthV2Paths.requestOtp);
}
