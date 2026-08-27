/** Log routing metadata, never user-provided URLs, headers, queries or bodies. */
export function serializeApiRequest(request: {
  method?: string;
  routeOptions?: { url?: string };
}) {
  return { method: request.method, route: request.routeOptions?.url ?? "unmatched" };
}
