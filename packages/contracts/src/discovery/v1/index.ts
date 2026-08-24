import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import { mediaIdContract } from "../../media-v1";
import {
  eventActorV1Contract,
  eventEnvelopeV1Contract,
  moneyV1Contract,
  productIdContract,
  storeIdContract,
  timestampV1Contract,
} from "../../platform/v1/index";
import { storeSlugContract } from "../../store-identifiers";

export const discoveryFeedCursorContract = z.string().min(1).max(2_048);
export const discoveryFeedLimitContract = z.coerce.number().int().min(1).max(30);

const discoveryFeedMediaContract = z
  .object({
    id: mediaIdContract,
    url: z.string().regex(/^\/v1\/media\/[0-9a-f-]{36}$/),
  })
  .strict();

export const discoveryFeedItemV1Contract = z
  .object({
    productId: productIdContract,
    storeId: storeIdContract,
    storeSlug: storeSlugContract,
    store: z
      .object({
        name: z.string().min(2).max(80),
        logo: discoveryFeedMediaContract.nullable(),
      })
      .strict(),
    product: z
      .object({
        name: z.string().min(2).max(120),
        image: discoveryFeedMediaContract,
      })
      .strict(),
    priceRange: z
      .object({ minimum: moneyV1Contract, maximum: moneyV1Contract })
      .strict(),
    availability: z.enum(["AVAILABLE", "OUT_OF_STOCK"]),
    projectionVersions: z
      .object({
        store: z.int().positive(),
        publication: z.int().positive(),
        offer: z.int().positive(),
        availability: z.int().nonnegative(),
      })
      .strict(),
  })
  .strict();

const discoveryFeedEmptyStateV1Contract = z
  .object({
    message: z.string().min(1),
    nextAction: z.string().min(1),
  })
  .strict();

export const discoveryFeedPageV1Contract = z
  .object({
    version: z.literal(1),
    items: z.array(discoveryFeedItemV1Contract).max(30),
    nextCursor: discoveryFeedCursorContract.optional(),
    snapshotAt: timestampV1Contract,
    projectionUpdatedAt: timestampV1Contract,
    emptyState: discoveryFeedEmptyStateV1Contract.optional(),
  })
  .strict()
  .superRefine((page, context) => {
    if ((page.items.length === 0) !== Boolean(page.emptyState)) {
      context.addIssue({
        code: "custom",
        path: ["emptyState"],
        message: "Empty state must be present exactly when the page has no items",
      });
    }
  });

const discoveryFeedErrorBase = {
  message: z.string().min(1),
  correlationId: z.uuid(),
};

export const discoveryFeedErrorV1Contract = z.discriminatedUnion("code", [
  z.object({ code: z.literal("INVALID_CURSOR"), ...discoveryFeedErrorBase }).strict(),
  z.object({ code: z.literal("CURSOR_EXPIRED"), ...discoveryFeedErrorBase }).strict(),
  z
    .object({ code: z.literal("FEED_CURSOR_STALE"), ...discoveryFeedErrorBase })
    .strict(),
  z
    .object({ code: z.literal("PROJECTION_UNAVAILABLE"), ...discoveryFeedErrorBase })
    .strict(),
]);

export const storeFollowStatusV1Contract = z.enum(["ACTIVE", "INACTIVE"]);

export const storeFollowViewV1Contract = z
  .object({
    version: z.literal(1),
    storeId: storeIdContract,
    status: storeFollowStatusV1Contract,
    revision: z.int().positive(),
    followSetRevision: z.int().positive(),
    activatedAt: timestampV1Contract,
    deactivatedAt: timestampV1Contract.optional(),
  })
  .strict();

export const viewerStoreFollowV1Contract = z
  .object({
    isFollowing: z.boolean(),
    revision: z.int().positive().optional(),
  })
  .strict();

export const publicFollowerCountV1Contract = z
  .object({
    version: z.literal(1),
    storeId: storeIdContract,
    count: z.int().nonnegative(),
    updatedAt: timestampV1Contract,
  })
  .strict();

const storeFollowEventPayloadV1Contract = z
  .object({
    storeId: storeIdContract,
    relationRevision: z.int().positive(),
    followSetRevision: z.int().positive(),
  })
  .strict();

export const storeFollowActivatedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("StoreFollowActivated.v1"),
  actor: eventActorV1Contract,
  payload: storeFollowEventPayloadV1Contract,
});

export const storeFollowDeactivatedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("StoreFollowDeactivated.v1"),
  actor: eventActorV1Contract,
  payload: storeFollowEventPayloadV1Contract,
});

export const discoveryFollowIdempotencyKeyContract = z.string().min(1).max(200);
export const discoveryFollowRevisionTagContract = z.string().regex(/^"\d+"$/);

const discoveryFollowErrorBase = {
  message: z.string().min(1),
  correlationId: z.uuid(),
};

export const discoveryFollowErrorV1Contract = z.discriminatedUnion("code", [
  z.object({ code: z.literal("UNAUTHENTICATED"), ...discoveryFollowErrorBase }),
  z.object({ code: z.literal("STORE_NOT_FOUND"), ...discoveryFollowErrorBase }),
  z.object({ code: z.literal("SELF_FOLLOW_NOT_ALLOWED"), ...discoveryFollowErrorBase }),
  z.object({ code: z.literal("PRECONDITION_REQUIRED"), ...discoveryFollowErrorBase }),
  z.object({ code: z.literal("IDEMPOTENCY_CONFLICT"), ...discoveryFollowErrorBase }),
  z.object({
    code: z.literal("REVISION_CONFLICT"),
    ...discoveryFollowErrorBase,
    details: z.object({ currentRevision: z.int().nonnegative() }).strict(),
  }),
]);

export const discoveryV1Paths = {
  discoveryFeed: "/v1/feeds/discovery",
  activateStoreFollow: (storeId: string) => `/v1/me/follows/${storeId}`,
  deactivateStoreFollow: (storeId: string) => `/v1/me/follows/${storeId}`,
} as const;

export const discoveryFeedProjectionEventTypes = [
  "StorePublished.v1",
  "StoreUnpublished.v1",
  "ProductPublished.v1",
  "ProductPublished.v2",
  "ProductUnpublished.v1",
  "VariantPriceChanged.v1",
  "VariantAvailabilityChanged.v1",
] as const;

export const discoveryV1Schemas = {
  DiscoveryFeedCursor: discoveryFeedCursorContract,
  DiscoveryFeedLimit: discoveryFeedLimitContract,
  DiscoveryFeedItemV1: discoveryFeedItemV1Contract,
  DiscoveryFeedPageV1: discoveryFeedPageV1Contract,
  DiscoveryFeedErrorV1: discoveryFeedErrorV1Contract,
  DiscoveryStoreId: storeIdContract,
  DiscoveryFollowIdempotencyKey: discoveryFollowIdempotencyKeyContract,
  DiscoveryFollowRevisionTag: discoveryFollowRevisionTagContract,
  StoreFollowViewV1: storeFollowViewV1Contract,
  ViewerStoreFollowV1: viewerStoreFollowV1Contract,
  PublicFollowerCountV1: publicFollowerCountV1Contract,
  StoreFollowActivatedV1: storeFollowActivatedV1Contract,
  StoreFollowDeactivatedV1: storeFollowDeactivatedV1Contract,
  DiscoveryFollowErrorV1: discoveryFollowErrorV1Contract,
} as const;

export const discoveryV1Examples = {
  DiscoveryFeedCursor: "eyJraWQiOiJjdXJyZW50In0.signature",
  DiscoveryFeedLimit: 18,
  DiscoveryFeedItemV1: {
    productId: "0d113616-5ad8-45d2-a126-b5b3412b3dd7",
    storeId: "15f16eaf-1e01-4e40-b0e6-b8ce19268893",
    storeSlug: "khane-sofal",
    store: { name: "خانه سفال", logo: null },
    product: {
      name: "فنجان دست‌ساز",
      image: {
        id: "1a382de3-426f-469b-8314-da9acf76b1b2",
        url: "/v1/media/1a382de3-426f-469b-8314-da9acf76b1b2",
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
  DiscoveryFeedPageV1: {
    version: 1,
    items: [],
    snapshotAt: "2026-08-24T10:00:00.000Z",
    projectionUpdatedAt: "2026-08-24T09:59:58.000Z",
    emptyState: {
      message: "فعلاً کالایی برای دیدن نیست.",
      nextAction: "بعداً دوباره سر بزنید.",
    },
  },
  DiscoveryFeedErrorV1: {
    code: "PROJECTION_UNAVAILABLE",
    message: "نمایش کالاها فعلاً به‌روز نیست. کمی بعد دوباره تلاش کنید.",
    correlationId: "e47ac10b-58cc-4372-a567-0e02b2c3d479",
  },
  DiscoveryStoreId: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
  DiscoveryFollowIdempotencyKey: "follow-store-01",
  DiscoveryFollowRevisionTag: '"1"',
  StoreFollowViewV1: {
    version: 1,
    storeId: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
    status: "ACTIVE",
    revision: 1,
    followSetRevision: 1,
    activatedAt: "2026-08-24T08:30:00.000Z",
  },
  DiscoveryFollowErrorV1: {
    code: "REVISION_CONFLICT",
    message: "وضعیت دنبال‌کردن در جای دیگری تغییر کرده است.",
    correlationId: "e47ac10b-58cc-4372-a567-0e02b2c3d479",
    details: { currentRevision: 2 },
  },
} as const;

export function createDiscoveryV1JsonSchemas() {
  return createJsonSchemaMap(discoveryV1Schemas);
}

export type StoreFollowStatusV1 = z.infer<typeof storeFollowStatusV1Contract>;
export type DiscoveryFeedItemV1 = z.infer<typeof discoveryFeedItemV1Contract>;
export type DiscoveryFeedPageV1 = z.infer<typeof discoveryFeedPageV1Contract>;
export type StoreFollowViewV1 = z.infer<typeof storeFollowViewV1Contract>;
export type ViewerStoreFollowV1 = z.infer<typeof viewerStoreFollowV1Contract>;
export type PublicFollowerCountV1 = z.infer<typeof publicFollowerCountV1Contract>;
export type StoreFollowActivatedV1 = z.infer<typeof storeFollowActivatedV1Contract>;
export type StoreFollowDeactivatedV1 = z.infer<typeof storeFollowDeactivatedV1Contract>;
