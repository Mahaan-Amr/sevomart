import { expect, it } from "vitest";
import { serializeApiRequest } from "../../apps/api/src/http/request-log";

it("logs only method and route template without private URL, query, headers or body", () => {
  const request = {
    method: "GET",
    url: "/v1/media/private-media-id?caption=private",
    routeOptions: { url: "/v1/media/:mediaId" },
    headers: { cookie: "private-session" },
    body: { text: "private-message" },
  };
  expect(serializeApiRequest(request)).toEqual({
    method: "GET",
    route: "/v1/media/:mediaId",
  });
  expect(serializeApiRequest({ ...request, routeOptions: undefined })).toEqual({
    method: "GET",
    route: "unmatched",
  });
});
