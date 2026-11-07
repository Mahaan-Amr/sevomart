import { proxyIdentityRequest } from "../../../../../lib/identity-api-proxy";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const parts = (await context.params).path;
  let upstream: string | undefined;
  if (parts.join("/") === "session-revocations" && request.method === "POST")
    upstream = "/v2/platform/security/session-revocations";
  else if (
    ["enrollment", "enrollment/confirmation", "proofs", "recoveries"].includes(
      parts.join("/"),
    ) &&
    request.method === "POST"
  )
    upstream = `/v1/platform/auth/totp/${parts.join("/")}`;
  else if (
    parts[0] === "recoveries" &&
    parts.length >= 2 &&
    uuid.test(parts[1] ?? "")
  ) {
    if (parts.length === 2 && request.method === "GET")
      upstream = `/v1/platform/auth/totp/recoveries/${parts[1]}`;
    if (
      parts.length === 3 &&
      ["approvals", "enrollment", "confirmation"].includes(parts[2] ?? "") &&
      request.method === "POST"
    )
      upstream = `/v1/platform/auth/totp/recoveries/${parts[1]}/${parts[2]}`;
  }
  if (!upstream)
    return Response.json({ message: "مسیر در دسترس نیست." }, { status: 404 });
  return proxyIdentityRequest(request, upstream);
}
export const GET = proxy;
export const POST = proxy;
