import { proxyJsonApiRequest } from "../../../../lib/json-api-proxy";

export async function POST(request: Request) {
  return proxyJsonApiRequest(request, [], {
    basePath: "/v1/buyer-dispute-media-contexts",
    isAllowed: (segments) => segments.length === 0,
    responseHeaders: ["content-type", "x-correlation-id"],
    noStore: true,
  });
}
