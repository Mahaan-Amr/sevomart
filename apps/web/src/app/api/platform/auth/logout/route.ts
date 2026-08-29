import { platformAgentWorkspaceV1Paths } from "@sevo/contracts/identity-access/v1";

import { proxyIdentityRequest } from "../../../../../lib/identity-api-proxy";

export async function POST(request: Request) {
  const upstream = await proxyIdentityRequest(
    request,
    platformAgentWorkspaceV1Paths.logout,
    true,
  );
  if (!upstream.ok) return upstream;

  const headers = new Headers({
    location: new URL("/platform/login", request.url).toString(),
  });
  const sessionCookie = upstream.headers.get("set-cookie");
  if (sessionCookie) headers.set("set-cookie", sessionCookie);
  return new Response(null, { status: 303, headers });
}
