import { proxyStoreRequest } from "../../../../lib/store-api-proxy";

type Context = { params: Promise<{ segments: string[] }> };

async function proxy(request: Request, context: Context) {
  const { segments } = await context.params;
  return proxyStoreRequest(request, segments);
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
