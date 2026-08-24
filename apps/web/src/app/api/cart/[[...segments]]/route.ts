import { proxyCartRequest } from "../../../../lib/cart-api-proxy";

type RouteContext = { params: Promise<{ segments?: string[] }> };

async function handle(request: Request, context: RouteContext) {
  return proxyCartRequest(request, (await context.params).segments ?? []);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
