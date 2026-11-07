import { violationCaseIdContract } from "@sevo/contracts/problem-follow-up/v1";
import { proxyApiRequest } from "../../../../../lib/identity-api-proxy";
type Context = { params: Promise<{ segments?: string[] }> };
export async function GET(request: Request, context: Context) {
  const segments = (await context.params).segments ?? [];
  const id = violationCaseIdContract.safeParse(segments[0]);
  if (!id.success || segments.length !== 1) return new Response(null, { status: 404 });
  return proxyApiRequest(request, `/v3/platform/violations/${id.data}`);
}
