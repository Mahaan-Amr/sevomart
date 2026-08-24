import {
  createDiscoveryV1JsonSchemas,
  discoveryFeedPageV1Contract,
  discoveryV1Paths,
} from "@sevo/contracts/discovery/v1";
import { describe, expect, it } from "vitest";

import { composeOpenApi } from "../../apps/api/src/openapi/compose-openapi";

const ids = {
  product: "0d113616-5ad8-45d2-a126-b5b3412b3dd7",
  store: "15f16eaf-1e01-4e40-b0e6-b8ce19268893",
  image: "1a382de3-426f-469b-8314-da9acf76b1b2",
};

describe("public discovery feed v1 contract", () => {
  it("publishes a strict public page without popularity or viewer data", () => {
    const page = discoveryFeedPageV1Contract.parse({
      version: 1,
      items: [
        {
          productId: ids.product,
          storeId: ids.store,
          storeSlug: "khane-sofal",
          store: { name: "خانه سفال", logo: null },
          product: {
            name: "فنجان دست‌ساز",
            image: {
              id: ids.image,
              url: `/v1/media/${ids.image}`,
            },
          },
          priceRange: {
            minimum: { amount: 1_200_000, currency: "IRR" },
            maximum: { amount: 1_200_000, currency: "IRR" },
          },
          availability: "AVAILABLE",
          projectionVersions: {
            store: 2,
            publication: 3,
            offer: 4,
            availability: 5,
          },
        },
      ],
      nextCursor: "opaque.signed.cursor",
      snapshotAt: "2026-08-24T10:00:00.000Z",
      projectionUpdatedAt: "2026-08-24T09:59:58.000Z",
    });

    expect(JSON.stringify(page)).not.toMatch(
      /identity|viewer|follow|viewCount|like|save|conversion|score|reason/i,
    );
    expect(
      discoveryFeedPageV1Contract.safeParse({
        ...page,
        viewerIsFollowing: true,
      }).success,
    ).toBe(false);
  });

  it("defines a human empty state and the versioned public route", () => {
    expect(
      discoveryFeedPageV1Contract.parse({
        version: 1,
        items: [],
        snapshotAt: "2026-08-24T10:00:00.000Z",
        projectionUpdatedAt: "2026-08-24T09:59:58.000Z",
        emptyState: {
          message: "فعلاً کالایی برای دیدن نیست.",
          nextAction: "بعداً دوباره سر بزنید.",
        },
      }),
    ).toMatchObject({ items: [], emptyState: { message: expect.any(String) } });
    expect(discoveryV1Paths.discoveryFeed).toBe("/v1/feeds/discovery");
    expect(createDiscoveryV1JsonSchemas()).toMatchObject({
      DiscoveryFeedPageV1: expect.any(Object),
      DiscoveryFeedErrorV1: expect.any(Object),
      DiscoveryFeedCursor: expect.any(Object),
      DiscoveryFeedLimit: expect.any(Object),
    });
  });

  it("publishes optional cursor auth and projection failure metadata in OpenAPI", () => {
    const document = composeOpenApi({
      openapi: "3.0.0",
      info: { title: "test", version: "1" },
      paths: {},
      components: { schemas: {} },
    });
    const operation = document.paths["/v1/feeds/discovery"]?.get;

    expect(operation).toMatchObject({
      operationId: "getDiscoveryFeed",
      security: [],
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: "cursor", in: "query", required: false }),
        expect.objectContaining({ name: "limit", in: "query", required: false }),
      ]),
      responses: {
        "200": expect.objectContaining({
          headers: expect.objectContaining({
            "X-Projection-Lag-Ms": expect.any(Object),
          }),
        }),
        "400": expect.any(Object),
        "409": expect.any(Object),
        "410": expect.any(Object),
        "503": expect.objectContaining({
          headers: expect.objectContaining({ "Retry-After": expect.any(Object) }),
        }),
      },
    });
  });
});
