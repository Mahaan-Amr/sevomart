import { proxyJsonApiRequest } from "../../../../lib/json-api-proxy";

export function POST(request: Request) {
  return proxyJsonApiRequest(request, ["media-contexts"], {
    basePath: "/v2/purchase-experiences",
    isAllowed: (segments) => segments.length === 1 && segments[0] === "media-contexts",
    responseHeaders: ["content-type"],
    noStore: true,
  });
}
