import { proxyJsonApiRequest } from "./json-api-proxy";

export async function proxyCartRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  const v2 = segments[0] === "v2";
  const routedSegments = v2 ? segments.slice(1) : segments;
  return proxyJsonApiRequest(request, routedSegments, {
    basePath: v2 ? "/v2/cart" : "/v1/cart",
    isAllowed: (parts) => isAllowed(parts, v2),
    responseHeaders: ["content-type", "set-cookie", "retry-after"],
  });
}

function isAllowed(segments: readonly string[], v2: boolean) {
  const path = segments.join("/");
  if (v2)
    return (
      path === "" ||
      path === "attach" ||
      path === "review" ||
      /^items\/[0-9a-f-]{36}$/.test(path)
    );
  return (
    path === "" ||
    path === "attach" ||
    path === "resolve" ||
    path === "review" ||
    path === "store-replacement" ||
    /^items\/[0-9a-f-]{36}$/.test(path)
  );
}
