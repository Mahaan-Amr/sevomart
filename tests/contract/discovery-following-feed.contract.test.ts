import {
  createDiscoveryV1JsonSchemas,
  discoveryFeedErrorV1Contract,
  discoveryFollowingFeedPageV1Contract,
  discoveryV1Paths,
} from "@sevo/contracts/discovery/v1";
import { describe, expect, it } from "vitest";

import { composeOpenApi } from "../../apps/api/src/openapi/compose-openapi";

describe("following feed v1 contract", () => {
  it("distinguishes no followed stores from no eligible products", () => {
    const base = {
      version: 1 as const,
      items: [],
      snapshotAt: "2026-08-24T10:00:00.000Z",
      projectionUpdatedAt: "2026-08-24T09:59:58.000Z",
      followSetRevision: 3,
    };

    expect(
      discoveryFollowingFeedPageV1Contract.parse({
        ...base,
        visibleFollowedStoreCount: 0,
        emptyState: {
          message: "برای دیدن کالاهای فروشگاه‌ها، چند فروشگاه را دنبال کنید.",
          nextAction: "رفتن به کشف",
        },
      }).emptyState,
    ).toMatchObject({ nextAction: "رفتن به کشف" });
    expect(
      discoveryFollowingFeedPageV1Contract.parse({
        ...base,
        visibleFollowedStoreCount: 2,
        emptyState: {
          message: "فعلاً کالای تازه‌ای نیست.",
          nextAction: "بعداً دوباره سر بزنید.",
        },
      }).visibleFollowedStoreCount,
    ).toBe(2);
  });

  it("publishes an authenticated route with private projection metadata", () => {
    const document = composeOpenApi({
      openapi: "3.0.0",
      info: { title: "test", version: "1" },
      paths: {},
      components: { schemas: {} },
    });
    const operation = document.paths["/v1/me/feeds/following"]?.get;

    expect(discoveryV1Paths.followingFeed).toBe("/v1/me/feeds/following");
    expect(createDiscoveryV1JsonSchemas()).toHaveProperty("FollowingFeedPageV1");
    expect(operation).toMatchObject({
      operationId: "getFollowingFeed",
      security: [{ identitySession: [] }],
      responses: {
        "200": expect.objectContaining({
          headers: expect.objectContaining({
            "X-Projection-Lag-Ms": expect.any(Object),
          }),
        }),
        "401": expect.any(Object),
        "403": expect.any(Object),
        "409": expect.any(Object),
      },
    });
    expect(
      discoveryFeedErrorV1Contract.parse({
        code: "UNAUTHENTICATED",
        message: "برای دیدن دنبال‌شده‌ها وارد شوید.",
        correlationId: "e47ac10b-58cc-4372-a567-0e02b2c3d479",
      }),
    ).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(
      discoveryFeedErrorV1Contract.parse({
        code: "IDENTITY_INACTIVE",
        message: "این هویت غیرفعال است؛ برای پیگیری با پشتیبانی تماس بگیرید.",
        correlationId: "e47ac10b-58cc-4372-a567-0e02b2c3d479",
      }),
    ).toMatchObject({ code: "IDENTITY_INACTIVE" });
  });

  it("contracts refresh-required when follow or unfollow changes pagination", () => {
    const stale = discoveryFeedErrorV1Contract.parse({
      code: "FEED_CURSOR_STALE",
      message: "فروشگاه‌های دنبال‌شده تغییر کرده‌اند؛ فید را تازه کنید.",
      correlationId: "e47ac10b-58cc-4372-a567-0e02b2c3d479",
    });
    const document = composeOpenApi({
      openapi: "3.0.0",
      info: { title: "test", version: "1" },
      paths: {},
      components: { schemas: {} },
    });

    expect(stale.code).toBe("FEED_CURSOR_STALE");
    expect(document.paths["/v1/me/feeds/following"]?.get.responses).toHaveProperty(
      "409",
    );
  });
});
