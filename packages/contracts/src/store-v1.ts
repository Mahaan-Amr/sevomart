import { z } from "zod";

import { createJsonSchemaMap } from "./json-schema";
import { mediaIdContract, mediaReferenceContract } from "./media-v1";
import { eventEnvelopeV1Contract, storeIdContract } from "./platform/v1/index";

export const storeSlugContract = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .brand<"StoreSlug">();

export const shippingMethodContract = z.object({
  code: z.enum(["NATIONAL_POST", "COURIER", "PICKUP"]),
  label: z.string().min(2).max(60),
});

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
  shippingMethods: z.array(shippingMethodContract).min(1).max(5),
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
  updatedAt: z.string().datetime({ offset: true }),
};

const draftStoreContract = z.object({
  ...storeRecordMetadata,
  name: requiredStoreFields.name.optional(),
  slug: requiredStoreFields.slug.optional(),
  bio: requiredStoreFields.bio.optional(),
  shippingMethods: requiredStoreFields.shippingMethods.optional(),
  returnPolicy: requiredStoreFields.returnPolicy.optional(),
  settlementDestination: verifiedSettlementDestinationContract.optional(),
  logoMediaId: optionalStoreFields.logoMediaId.optional(),
  coverMediaId: optionalStoreFields.coverMediaId.optional(),
  themeColor: optionalStoreFields.themeColor.optional(),
  status: z.literal("DRAFT"),
});

const publishedStoreRecordContract = z.object({
  ...storeRecordMetadata,
  ...requiredStoreFields,
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
  name: requiredStoreFields.name,
  slug: requiredStoreFields.slug,
  bio: requiredStoreFields.bio,
  shippingMethods: requiredStoreFields.shippingMethods,
  returnPolicy: requiredStoreFields.returnPolicy,
  settlementDestination: verifiedSettlementDestinationContract,
  logo: mediaReferenceContract.nullable(),
  cover: mediaReferenceContract.nullable(),
  themeColor: optionalStoreFields.themeColor,
  status: z.literal("PUBLISHED"),
  publishedAt: z.string().datetime({ offset: true }),
  activeProductCount: z.number().int().nonnegative(),
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
  payload: z
    .object({
      storeId: storeIdContract,
      publicationStatus: z.literal("PUBLISHED"),
    })
    .strict(),
});

export const storeV1Schemas = {
  StoreSlug: storeSlugContract,
  StoreDraftInput: storeDraftInputContract,
  StoreDraft: storeDraftContract,
  SlugAvailability: slugAvailabilityContract,
  StorePreview: storePreviewContract,
  PublicStore: publicStoreContract,
  StorePublication: storePublicationContract,
  SlugConflictError: slugConflictErrorContract,
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
  settlementDestination: {
    ...completeDraftInputExample.settlementDestination,
    status: "TEST_VERIFIED",
  },
  status: "DRAFT",
  updatedAt: "2026-08-16T09:00:00.000Z",
} as const;

const publicStoreExample = {
  id: completeDraftExample.id,
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
