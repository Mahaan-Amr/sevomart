import { contentV2Operations } from "@sevo/contracts/content/v2";
import { productIdContract } from "@sevo/contracts/platform/v1";

import { proxyJsonApiRequest } from "../../../../../lib/json-api-proxy";

export function GET(
  request: Request,
  context: { params: Promise<{ productId: string }> },
) {
  return context.params.then(({ productId }) => {
    if (!productIdContract.safeParse(productId).success) {
      return Response.json({ message: "کالا معتبر نیست." }, { status: 400 });
    }
    return proxyJsonApiRequest(request, [], {
      basePath: contentV2Operations.readProductSalesContent.path.replace(
        "{productId}",
        encodeURIComponent(productId),
      ),
      isAllowed: (segments) => segments.length === 0,
      responseHeaders: ["content-type", "x-correlation-id"],
      noStore: true,
    });
  });
}
