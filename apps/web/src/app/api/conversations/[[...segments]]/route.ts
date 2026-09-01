import { proxyConversationsRequest } from "../../../../lib/conversations-api-proxy";

type Context = { params: Promise<{ segments?: string[] }> };

async function proxy(request: Request, context: Context) {
  const { segments = [] } = await context.params;
  return proxyConversationsRequest(request, segments);
}

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
