import { proxyConversationMediaRequest } from "../../../../lib/conversations-api-proxy";

type Context = { params: Promise<{ mediaId: string }> };

export async function GET(request: Request, context: Context) {
  return proxyConversationMediaRequest(request, (await context.params).mediaId);
}
