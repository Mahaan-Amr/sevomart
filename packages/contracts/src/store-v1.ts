import { z } from "zod";

import { createJsonSchemaMap } from "./json-schema";
import { mediaIdContract, mediaReferenceContract } from "./media-v1";
import { storeSlugContract } from "./store-identifiers";
import {
  publicFollowerCountV1Contract,
  viewerStoreFollowV1Contract,
} from "./discovery/v1/index";
import {
  eventActorV1Contract,
  eventEnvelopeV1Contract,
  identityIdContract,
  moneyV1Contract,
  storeIdContract,
  timestampV1Contract,
} from "./platform/v1/index";

export { storeSlugContract } from "./store-identifiers";

export const storeIdempotencyKeyContract = z.string().min(1).max(200);
export const storeRevisionTagContract = z.string().regex(/^"\d+"$/);

export const shippingMethodContract = z.object({
  code: z.enum(["NATIONAL_POST", "COURIER", "PICKUP"]),
  label: z.string().min(2).max(60),
});

const shippingMethodsInputContract = z
  .array(shippingMethodContract)
  .min(1)
  .max(5)
  .superRefine((methods, context) => {
    const codes = new Set<string>();
    methods.forEach((method, index) => {
      if (codes.has(method.code)) {
        context.addIssue({
          code: "custom",
          message: "Shipping method codes must be unique",
          path: [index, "code"],
        });
      }
      codes.add(method.code);
    });
  });

export const storeShippingMethodSnapshotV1Contract = shippingMethodContract
  .extend({
    id: z.uuid(),
    revision: z.int().positive(),
    fixedFee: moneyV1Contract,
    estimatedDeliveryText: z.string().min(2).max(120),
    enabled: z.boolean(),
    requiresDeliveryAddress: z.boolean(),
    requiresPostalCode: z.boolean(),
  })
  .strict();

export const storeReturnPolicySnapshotV1Contract = z
  .object({
    revision: z.int().positive(),
    text: z.string().min(10).max(1_000),
  })
  .strict();

export const storeDisplayIdentityV1Contract = z
  .object({
    name: z.string().min(2).max(80),
    bio: z.string().min(2).max(240),
    logoMediaId: mediaIdContract.nullable(),
    coverMediaId: mediaIdContract.nullable(),
    themeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  })
  .strict();

export const storeAuthoritativeSnapshotV1Contract = z
  .object({
    storeId: storeIdContract,
    revision: z.int().positive(),
    publicationVersion: z.int().nonnegative(),
    publicationStatus: z.enum(["DRAFT", "PUBLISHED"]),
    owner: z.object({ identityId: identityIdContract }).strict(),
    slug: storeSlugContract.optional(),
    displayIdentity: storeDisplayIdentityV1Contract.partial(),
    shippingMethods: z.array(storeShippingMethodSnapshotV1Contract).max(5),
    returnPolicy: storeReturnPolicySnapshotV1Contract.optional(),
    settlement: z
      .object({ mode: z.literal("DIRECT"), status: z.literal("TEST_VERIFIED") })
      .strict()
      .optional(),
    updatedAt: timestampV1Contract,
    publishedAt: timestampV1Contract.optional(),
  })
  .strict();

const settlementDestinationInputContract = z.object({
  kind: z.literal("TEST"),
});

const verifiedSettlementDestinationContract = settlementDestinationInputContract.extend(
  {
    status: z.literal("TEST_VERIFIED"),
  },
);

const requiredStoreFields = {
  name: z.string().min(2).max(80),
  slug: storeSlugContract,
  bio: z.string().min(2).max(240),
  shippingMethods: shippingMethodsInputContract,
  returnPolicy: z.string().min(10).max(1_000),
  settlementDestination: settlementDestinationInputContract,
};

const optionalStoreFields = {
  logoMediaId: mediaIdContract.nullable(),
  coverMediaId: mediaIdContract.nullable(),
  themeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
};

export const storeDraftInputContract = z.object({
  name: requiredStoreFields.name.optional(),
  slug: requiredStoreFields.slug.optional(),
  bio: requiredStoreFields.bio.optional(),
  shippingMethods: requiredStoreFields.shippingMethods.optional(),
  returnPolicy: requiredStoreFields.returnPolicy.optional(),
  settlementDestination: requiredStoreFields.settlementDestination.optional(),
  logoMediaId: optionalStoreFields.logoMediaId.optional(),
  coverMediaId: optionalStoreFields.coverMediaId.optional(),
  themeColor: optionalStoreFields.themeColor.optional(),
});

const storeRecordMetadata = {
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  publicationVersion: z.number().int().nonnegative(),
  returnPolicyRevision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime({ offset: true }),
};

const draftStoreContract = z.object({
  ...storeRecordMetadata,
  name: requiredStoreFields.name.optional(),
  slug: requiredStoreFields.slug.optional(),
  bio: requiredStoreFields.bio.optional(),
  shippingMethods: z
    .array(storeShippingMethodSnapshotV1Contract)
    .min(1)
    .max(5)
    .optional(),
  returnPolicy: requiredStoreFields.returnPolicy.optional(),
  settlementDestination: verifiedSettlementDestinationContract.optional(),
  logoMediaId: optionalStoreFields.logoMediaId.optional(),
  coverMediaId: optionalStoreFields.coverMediaId.optional(),
  themeColor: optionalStoreFields.themeColor.optional(),
  status: z.literal("DRAFT"),
});

const publishedStoreRecordContract = z.object({
  ...storeRecordMetadata,
  name: requiredStoreFields.name,
  slug: requiredStoreFields.slug,
  bio: requiredStoreFields.bio,
  shippingMethods: z.array(storeShippingMethodSnapshotV1Contract).min(1).max(5),
  returnPolicy: requiredStoreFields.returnPolicy,
  settlementDestination: verifiedSettlementDestinationContract,
  logoMediaId: optionalStoreFields.logoMediaId,
  coverMediaId: optionalStoreFields.coverMediaId,
  themeColor: optionalStoreFields.themeColor,
  status: z.literal("PUBLISHED"),
});

export const storeDraftContract = z.discriminatedUnion("status", [
  draftStoreContract,
  publishedStoreRecordContract,
]);

export const slugAvailabilityContract = z.object({
  slug: storeSlugContract,
  available: z.boolean(),
});

export const slugConflictErrorContract = z.object({
  code: z.literal("SLUG_CONFLICT"),
  message: z.string().min(1),
  correlationId: z.string().min(1),
  details: z.object({ slug: storeSlugContract }),
});

export const storeNotFoundErrorContract = z.object({
  code: z.literal("STORE_NOT_FOUND"),
  message: z.string().min(1),
  correlationId: z.string().min(1),
});

export const storeRevisionConflictErrorContract = z.object({
  code: z.literal("STORE_REVISION_CONFLICT"),
  message: z.string().min(1),
  correlationId: z.string().min(1),
  details: z.object({
    expectedRevision: z.number().int().nonnegative(),
    currentRevision: z.number().int().nonnegative(),
  }),
});

export const storeIdempotencyConflictErrorContract = z.object({
  code: z.literal("IDEMPOTENCY_CONFLICT"),
  message: z.string().min(1),
  correlationId: z.string().min(1),
});

export const storeWriteConflictErrorContract = z.discriminatedUnion("code", [
  slugConflictErrorContract,
  storeRevisionConflictErrorContract,
  storeIdempotencyConflictErrorContract,
]);

export const storePreconditionRequiredErrorContract = z.object({
  code: z.literal("PRECONDITION_REQUIRED"),
  message: z.string().min(1),
  correlationId: z.string().min(1),
});

export const storePreviewContract = z.object({
  store: storeDraftContract,
  publicationReadiness: z.object({
    ready: z.boolean(),
    missingFields: z.array(
      z.enum([
        "NAME",
        "SLUG",
        "BIO",
        "SHIPPING_METHOD",
        "RETURN_POLICY",
        "SETTLEMENT_DESTINATION",
      ]),
    ),
  }),
});

export const publicStoreContract = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  publicationVersion: z.number().int().positive(),
  returnPolicyRevision: z.number().int().positive(),
  name: requiredStoreFields.name,
  slug: requiredStoreFields.slug,
  bio: requiredStoreFields.bio,
  shippingMethods: z.array(storeShippingMethodSnapshotV1Contract).min(1).max(5),
  returnPolicy: requiredStoreFields.returnPolicy,
  settlementDestination: verifiedSettlementDestinationContract,
  logo: mediaReferenceContract.nullable(),
  cover: mediaReferenceContract.nullable(),
  themeColor: optionalStoreFields.themeColor,
  status: z.literal("PUBLISHED"),
  publishedAt: z.string().datetime({ offset: true }),
  activeProductCount: z.number().int().nonnegative(),
  followerCount: publicFollowerCountV1Contract.optional(),
  viewer: viewerStoreFollowV1Contract.optional(),
  trust: z.object({
    settlementStatus: z.literal("TEST_VERIFIED"),
    platformBrandingRequired: z.literal(true),
  }),
});

export const storePublicationContract = z.object({
  store: publicStoreContract,
  publicUrl: z.string().regex(/^\/s\/[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const storePublishedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("StorePublished.v1"),
  actor: eventActorV1Contract,
  payload: z
    .object({
      storeId: storeIdContract,
      publicationStatus: z.literal("PUBLISHED"),
      publicationVersion: z.int().positive().optional(),
    })
    .strict(),
});

export const storeUnpublishedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("StoreUnpublished.v1"),
  actor: eventActorV1Contract,
  payload: z
    .object({
      storeId: storeIdContract,
      publicationStatus: z.literal("DRAFT"),
      publicationVersion: z.int().nonnegative(),
    })
    .strict(),
});

export const storePolicyChangedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("StorePolicyChanged.v1"),
  actor: eventActorV1Contract,
  payload: z
    .object({
      storeId: storeIdContract,
      returnPolicyRevision: z.int().nonnegative(),
      shippingMethods: z.array(
        z.object({ id: z.uuid(), revision: z.int().positive() }).strict(),
      ),
    })
    .strict(),
});

export const storeV1Schemas = {
  StoreSlug: storeSlugContract,
  StoreIdempotencyKey: storeIdempotencyKeyContract,
  StoreRevisionTag: storeRevisionTagContract,
  StoreDraftInput: storeDraftInputContract,
  StoreDraft: storeDraftContract,
  SlugAvailability: slugAvailabilityContract,
  StorePreview: storePreviewContract,
  PublicStore: publicStoreContract,
  StorePublication: storePublicationContract,
  SlugConflictError: slugConflictErrorContract,
  StoreWriteConflictError: storeWriteConflictErrorContract,
  StorePreconditionRequiredError: storePreconditionRequiredErrorContract,
  StoreNotFoundError: storeNotFoundErrorContract,
} as const;

export function createStoreV1JsonSchemas() {
  return createJsonSchemaMap(storeV1Schemas);
}

const completeDraftInputExample = {
  name: "خانه سفال ماه",
  slug: "khane-sofal-mah",
  bio: "سفال دست‌ساز برای خانه‌های گرم و ساده",
  shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
  returnPolicy: "تا هفت روز پس از تحویل، امکان درخواست مرجوعی وجود دارد.",
  settlementDestination: {
    kind: "TEST",
  },
  logoMediaId: null,
  coverMediaId: null,
  themeColor: "#A41439",
} as const;

const completeDraftExample = {
  ...completeDraftInputExample,
  id: "5f683499-e223-4b79-b353-0a75c7261b71",
  revision: 1,
  publicationVersion: 0,
  returnPolicyRevision: 1,
  shippingMethods: [
    {
      id: "a47ac10b-58cc-4372-a567-0e02b2c3d479",
      revision: 1,
      code: "NATIONAL_POST",
      label: "پست پیشتاز",
      fixedFee: { amount: 0, currency: "IRR" },
      estimatedDeliveryText: "زمان دقیق ارسال هنگام ثبت سفارش مشخص می‌شود.",
      enabled: true,
      requiresDeliveryAddress: true,
      requiresPostalCode: true,
    },
  ],
  settlementDestination: {
    ...completeDraftInputExample.settlementDestination,
    status: "TEST_VERIFIED",
  },
  status: "DRAFT",
  updatedAt: "2026-08-16T09:00:00.000Z",
} as const;

const publicStoreExample = {
  id: completeDraftExample.id,
  revision: 2,
  publicationVersion: 1,
  returnPolicyRevision: completeDraftExample.returnPolicyRevision,
  name: completeDraftExample.name,
  slug: completeDraftExample.slug,
  bio: completeDraftExample.bio,
  shippingMethods: completeDraftExample.shippingMethods,
  returnPolicy: completeDraftExample.returnPolicy,
  settlementDestination: completeDraftExample.settlementDestination,
  logo: null,
  cover: null,
  themeColor: completeDraftExample.themeColor,
  status: "PUBLISHED",
  publishedAt: "2026-08-16T09:30:00.000Z",
  activeProductCount: 0,
  trust: {
    settlementStatus: "TEST_VERIFIED",
    platformBrandingRequired: true,
  },
} as const;

export const storeV1Examples = {
  StoreSlug: "khane-sofal-mah",
  StoreIdempotencyKey: "01K3F7W5M8S7A4N2Z6Q9H1J3RC",
  StoreRevisionTag: '"1"',
  StoreDraftInput: completeDraftInputExample,
  StoreDraft: completeDraftExample,
  SlugAvailability: { slug: "khane-sofal-mah", available: true },
  StorePreview: {
    store: completeDraftExample,
    publicationReadiness: { ready: true, missingFields: [] },
  },
  PublicStore: publicStoreExample,
  StorePublication: {
    store: publicStoreExample,
    publicUrl: "/s/khane-sofal-mah",
  },
  SlugConflictError: {
    code: "SLUG_CONFLICT",
    message: "این شناسه لینک قبلاً استفاده شده است",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
    details: { slug: "khane-sofal-mah" },
  },
  StoreWriteConflictError: {
    code: "STORE_REVISION_CONFLICT",
    message: "فروشگاه در جای دیگری تغییر کرده است",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
    details: { expectedRevision: 1, currentRevision: 2 },
  },
  StorePreconditionRequiredError: {
    code: "PRECONDITION_REQUIRED",
    message: "نسخه فروشگاه و شناسه یکتای درخواست لازم است",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
  StoreNotFoundError: {
    code: "STORE_NOT_FOUND",
    message: "فروشگاه پیدا نشد",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
} as const;

export type StoreSlug = z.infer<typeof storeSlugContract>;
export type StoreDraftInput = z.infer<typeof storeDraftInputContract>;
export type StoreDraft = z.infer<typeof storeDraftContract>;
export type SlugAvailability = z.infer<typeof slugAvailabilityContract>;
export type StorePreview = z.infer<typeof storePreviewContract>;
export type PublicStore = z.infer<typeof publicStoreContract>;
export type StorePublication = z.infer<typeof storePublicationContract>;
export type StorePublishedV1 = z.infer<typeof storePublishedV1Contract>;
export type StoreUnpublishedV1 = z.infer<typeof storeUnpublishedV1Contract>;
export type StorePolicyChangedV1 = z.infer<typeof storePolicyChangedV1Contract>;
export type StoreAuthoritativeSnapshotV1 = z.infer<
  typeof storeAuthoritativeSnapshotV1Contract
>;
export type StoreShippingMethodSnapshotV1 = z.infer<
  typeof storeShippingMethodSnapshotV1Contract
>;
