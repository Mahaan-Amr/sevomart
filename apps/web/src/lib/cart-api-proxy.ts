import { proxyJsonApiRequest } from "./json-api-proxy";

export async function proxyCartRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  return proxyJsonApiRequest(request, segments, {
    basePath: "/v1/cart",
    isAllowed,
    responseHeaders: ["content-type", "set-cookie", "retry-after"],
  });
}

function isAllowed(segments: readonly string[]) {
  const path = segments.join("/");
  return (
    path === "" ||
    path === "attach" ||
    path === "resolve" ||
    path === "review" ||
    path === "store-replacement" ||
    /^items\/[0-9a-f-]{36}$/.test(path)
  );
}
