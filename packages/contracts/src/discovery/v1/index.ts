import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import {
  eventActorV1Contract,
  eventEnvelopeV1Contract,
  storeIdContract,
  timestampV1Contract,
} from "../../platform/v1/index";

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
  activateStoreFollow: (storeId: string) => `/v1/me/follows/${storeId}`,
  deactivateStoreFollow: (storeId: string) => `/v1/me/follows/${storeId}`,
} as const;

export const discoveryV1Schemas = {
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
export type StoreFollowViewV1 = z.infer<typeof storeFollowViewV1Contract>;
export type ViewerStoreFollowV1 = z.infer<typeof viewerStoreFollowV1Contract>;
export type PublicFollowerCountV1 = z.infer<typeof publicFollowerCountV1Contract>;
export type StoreFollowActivatedV1 = z.infer<typeof storeFollowActivatedV1Contract>;
export type StoreFollowDeactivatedV1 = z.infer<typeof storeFollowDeactivatedV1Contract>;
