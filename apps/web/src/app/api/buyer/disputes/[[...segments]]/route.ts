import { proxyBuyerDisputeRequest } from "../../../../../lib/buyer-dispute-api-proxy";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
) {
  const { segments = [] } = await context.params;
  return proxyBuyerDisputeRequest(request, segments);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
) {
  const { segments = [] } = await context.params;
  return proxyBuyerDisputeRequest(request, segments);
}
