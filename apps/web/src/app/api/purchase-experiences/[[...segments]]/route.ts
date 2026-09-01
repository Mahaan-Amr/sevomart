import { proxyPurchaseExperiencesRequest } from "../../../../lib/content-api-proxy";

type Context = { params: Promise<{ segments?: string[] }> };

async function proxy(request: Request, context: Context) {
  return proxyPurchaseExperiencesRequest(
    request,
    (await context.params).segments ?? [],
  );
}

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
