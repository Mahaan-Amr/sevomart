import { disputeIdContract } from "@sevo/contracts/problem-follow-up/v1";
import { proxyApiRequest } from "../../../../../lib/identity-api-proxy";
type Context = { params: Promise<{ segments?: string[] }> };
async function proxy(request: Request, context: Context) {
  const segments = (await context.params).segments ?? [];
  const id = disputeIdContract.safeParse(segments[0]);
  if (
    !id.success ||
    (request.method === "GET"
      ? segments.length !== 1
      : segments.length !== 2 ||
        !["resolution", "reopening"].includes(segments[1] ?? ""))
  )
    return new Response(null, { status: 404 });
  return proxyApiRequest(
    request,
    `/v3/platform/disputes/${id.data}${segments.length === 2 ? `/${segments[1]}` : ""}`,
  );
}
export const GET = proxy;
export const POST = proxy;
