import { platformAgentWorkspaceV1Paths } from "@sevo/contracts/identity-access/v1";

import { proxyIdentityRequest } from "../../../../../lib/identity-api-proxy";

export function GET(request: Request) {
  return proxyIdentityRequest(request, platformAgentWorkspaceV1Paths.readSession);
}
