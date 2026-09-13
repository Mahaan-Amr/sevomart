import { proxyDevPaymentProviderRequest } from "../../../../../../lib/checkout-api-proxy";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ attemptId: string }> },
) {
  const { attemptId } = await context.params;
  const response = await proxyDevPaymentProviderRequest(request, [attemptId]);
  const location = response.headers.get("location");
  if (location && response.status >= 300 && response.status < 400) {
    const upstreamTarget = new URL(location);
    const requestUrl = new URL(request.url);
    const browserOrigin = `${requestUrl.protocol}//${request.headers.get("host") ?? requestUrl.host}`;
    return Response.redirect(
      new URL(`${upstreamTarget.pathname}${upstreamTarget.search}`, browserOrigin),
      response.status,
    );
  }
  return response;
}
