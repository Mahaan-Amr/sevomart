import { disputeIdContract } from "@sevo/contracts/problem-follow-up/v1";

import { proxyApiRequest } from "../../../../../lib/identity-api-proxy";

type RouteContext = { params: Promise<{ segments?: string[] }> };

export async function GET(request: Request, context: RouteContext) {
  const segments = (await context.params).segments ?? [];
  if (segments.length === 0) {
    return proxyApiRequest(request, "/v1/platform/disputes");
  }
  const disputeId = disputeIdContract.safeParse(segments[0]);
  if (segments.length !== 1 || !disputeId.success) return notFound();
  return proxyApiRequest(request, `/v1/platform/disputes/${disputeId.data}`);
}

export async function POST(request: Request, context: RouteContext) {
  const segments = (await context.params).segments ?? [];
  const disputeId = disputeIdContract.safeParse(segments[0]);
  if (!disputeId.success || segments.length !== 2) return notFound();
  if (segments[1] === "access") {
    return proxyApiRequest(request, "/v1/platform/access/sensitive-grants");
  }
  if (segments[1] === "resolution" || segments[1] === "reopening") {
    return proxyApiRequest(
      request,
      `/v2/platform/disputes/${disputeId.data}/${segments[1]}`,
    );
  }
  return notFound();
}

function notFound() {
  return Response.json(
    {
      code: "NOT_FOUND",
      message: "مسیر پرونده پیدا نشد.",
      correlationId: crypto.randomUUID(),
    },
    { status: 404 },
  );
}
