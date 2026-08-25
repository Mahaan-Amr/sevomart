import { proxyPaymentAttemptsRequest } from "../../../../lib/checkout-api-proxy";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ attemptId: string }> },
) {
  const { attemptId } = await context.params;
  return proxyPaymentAttemptsRequest(request, [attemptId]);
}
