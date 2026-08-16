import { z } from "zod";

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const iranianMobile = z.string().regex(/^09\d{9}$/);
const storeSlug = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const mediaId = uuid.nullable();

export const otpRequestContract = z.object({
  mobile: iranianMobile,
});

export const otpChallengeContract = z.object({
  challengeId: uuid,
  expiresAt: timestamp,
});

export const otpVerificationContract = z.object({
  challengeId: uuid,
  code: z.string().regex(/^\d{6}$/),
});

export const sellerSessionContract = z.object({
  seller: z.object({
    id: uuid,
    mobile: iranianMobile,
  }),
  expiresAt: timestamp,
});

export const shippingMethodContract = z.object({
  code: z.enum(["NATIONAL_POST", "COURIER", "PICKUP"]),
  label: z.string().min(2).max(60),
});

export const storeDraftInputContract = z.object({
  name: z.string().min(2).max(80),
  slug: storeSlug,
  bio: z.string().min(2).max(240),
  shippingMethods: z.array(shippingMethodContract).min(1).max(5),
  returnPolicy: z.string().min(10).max(1_000),
  settlementDestination: z.object({
    kind: z.literal("TEST"),
    reference: z.string().min(2).max(64),
  }),
  logoMediaId: mediaId,
  coverMediaId: mediaId,
  themeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

const settlementDestinationContract = z.object({
  kind: z.literal("TEST"),
  reference: z.string().min(2).max(64),
  status: z.literal("TEST_VERIFIED"),
});

export const storeDraftContract = storeDraftInputContract
  .omit({ settlementDestination: true })
  .extend({
    id: uuid,
    settlementDestination: settlementDestinationContract,
    status: z.enum(["DRAFT", "PUBLISHED"]),
    updatedAt: timestamp,
  });

export const slugAvailabilityContract = z.object({
  slug: storeSlug,
  available: z.boolean(),
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

export const publicStoreContract = storeDraftContract.omit({ updatedAt: true }).extend({
  status: z.literal("PUBLISHED"),
  publishedAt: timestamp,
  productCount: z.number().int().nonnegative(),
  trust: z.object({
    settlementStatus: z.literal("TEST_VERIFIED"),
    platformBrandingRequired: z.literal(true),
  }),
});

export const storePublicationContract = z.object({
  store: publicStoreContract,
  publicUrl: z.string().regex(/^\/s\/[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

const errorBase = {
  message: z.string().min(1),
  correlationId: z.string().min(1),
};

export const validationErrorContract = z.object({
  code: z.literal("VALIDATION_ERROR"),
  ...errorBase,
  details: z.object({
    issues: z.array(
      z.object({
        field: z.string().min(1),
        code: z.enum(["REQUIRED", "INVALID_FORMAT", "TOO_SHORT", "TOO_LONG"]),
      }),
    ),
  }),
});

export const slugConflictErrorContract = z.object({
  code: z.literal("SLUG_CONFLICT"),
  ...errorBase,
  details: z.object({ slug: storeSlug }),
});

export const unauthorizedErrorContract = z.object({
  code: z.literal("UNAUTHORIZED"),
  ...errorBase,
});

export const storeNotFoundErrorContract = z.object({
  code: z.literal("STORE_NOT_FOUND"),
  ...errorBase,
});

export const internalServerErrorContract = z.object({
  code: z.literal("INTERNAL_SERVER_ERROR"),
  ...errorBase,
});

export const identityStoreContractSchemas = {
  OtpRequest: otpRequestContract,
  OtpChallenge: otpChallengeContract,
  OtpVerification: otpVerificationContract,
  SellerSession: sellerSessionContract,
  StoreDraftInput: storeDraftInputContract,
  StoreDraft: storeDraftContract,
  SlugAvailability: slugAvailabilityContract,
  StorePreview: storePreviewContract,
  PublicStore: publicStoreContract,
  StorePublication: storePublicationContract,
  ValidationError: validationErrorContract,
  SlugConflictError: slugConflictErrorContract,
  UnauthorizedError: unauthorizedErrorContract,
  StoreNotFoundError: storeNotFoundErrorContract,
  InternalServerError: internalServerErrorContract,
} as const;

export type IdentityStoreSchemaName = keyof typeof identityStoreContractSchemas;

export function createIdentityStoreJsonSchemas(): Record<
  IdentityStoreSchemaName,
  Record<string, unknown>
> {
  return Object.fromEntries(
    Object.entries(identityStoreContractSchemas).map(([name, schema]) => {
      const generated = z.toJSONSchema(schema, {
        target: "openapi-3.0",
      }) as unknown as Record<string, unknown>;
      delete generated.$schema;
      return [name, generated];
    }),
  ) as unknown as Record<IdentityStoreSchemaName, Record<string, unknown>>;
}

const storeDraftInputExample = {
  name: "خانه سفال ماه",
  slug: "khane-sofal-mah",
  bio: "سفال دست‌ساز برای خانه‌های گرم و ساده",
  shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
  returnPolicy: "تا هفت روز پس از تحویل، امکان درخواست مرجوعی وجود دارد.",
  settlementDestination: {
    kind: "TEST",
    reference: "مقصد آزمایشی فروشگاه",
  },
  logoMediaId: null,
  coverMediaId: null,
  themeColor: "#A41439",
} as const;

const storeDraftExample = {
  ...storeDraftInputExample,
  id: "5f683499-e223-4b79-b353-0a75c7261b71",
  settlementDestination: {
    ...storeDraftInputExample.settlementDestination,
    status: "TEST_VERIFIED",
  },
  status: "DRAFT",
  updatedAt: "2026-08-16T09:00:00.000Z",
} as const;

const publicStoreExample = {
  ...storeDraftInputExample,
  id: storeDraftExample.id,
  settlementDestination: storeDraftExample.settlementDestination,
  status: "PUBLISHED",
  publishedAt: "2026-08-16T09:30:00.000Z",
  productCount: 0,
  trust: {
    settlementStatus: "TEST_VERIFIED",
    platformBrandingRequired: true,
  },
} as const;

export const identityStoreContractExamples = {
  OtpRequest: { mobile: "09123456789" },
  OtpChallenge: {
    challengeId: "5efea92d-e15f-454e-bc29-0368f667a21d",
    expiresAt: "2026-08-16T09:05:00.000Z",
  },
  OtpVerification: {
    challengeId: "5efea92d-e15f-454e-bc29-0368f667a21d",
    code: "111111",
  },
  SellerSession: {
    seller: {
      id: "8154cb9b-a8db-4a89-87f7-c14c27fefb3c",
      mobile: "09123456789",
    },
    expiresAt: "2026-08-23T09:00:00.000Z",
  },
  StoreDraftInput: storeDraftInputExample,
  StoreDraft: storeDraftExample,
  SlugAvailability: { slug: "khane-sofal-mah", available: true },
  StorePreview: {
    store: storeDraftExample,
    publicationReadiness: { ready: true, missingFields: [] },
  },
  PublicStore: publicStoreExample,
  StorePublication: {
    store: publicStoreExample,
    publicUrl: "/s/khane-sofal-mah",
  },
  ValidationError: {
    code: "VALIDATION_ERROR",
    message: "Request validation failed",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
    details: { issues: [{ field: "slug", code: "INVALID_FORMAT" }] },
  },
  SlugConflictError: {
    code: "SLUG_CONFLICT",
    message: "Store slug is already in use",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
    details: { slug: "khane-sofal-mah" },
  },
  UnauthorizedError: {
    code: "UNAUTHORIZED",
    message: "Seller session is required",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
  StoreNotFoundError: {
    code: "STORE_NOT_FOUND",
    message: "Store was not found",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
  InternalServerError: {
    code: "INTERNAL_SERVER_ERROR",
    message: "Unexpected server error",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
} as const satisfies Partial<Record<IdentityStoreSchemaName, unknown>>;

type ApiAuth = "none" | "seller-session";

type ApiResponseContract = {
  status: number;
  schema: IdentityStoreSchemaName;
};

type ApiOperationContract = {
  operationId: string;
  method: "get" | "post" | "put";
  path: string;
  auth: ApiAuth;
  request?: IdentityStoreSchemaName;
  responses: readonly ApiResponseContract[];
};

export const identityStoreApiOperations = [
  {
    operationId: "requestSellerOtp",
    method: "post",
    path: "/v1/auth/otp/requests",
    auth: "none",
    request: "OtpRequest",
    responses: [
      { status: 202, schema: "OtpChallenge" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "verifySellerOtp",
    method: "post",
    path: "/v1/auth/otp/verifications",
    auth: "none",
    request: "OtpVerification",
    responses: [
      { status: 200, schema: "SellerSession" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readStoreDraft",
    method: "get",
    path: "/v1/seller/store/draft",
    auth: "seller-session",
    responses: [
      { status: 200, schema: "StoreDraft" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "StoreNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "saveStoreDraft",
    method: "put",
    path: "/v1/seller/store/draft",
    auth: "seller-session",
    request: "StoreDraftInput",
    responses: [
      { status: 200, schema: "StoreDraft" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 409, schema: "SlugConflictError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "checkStoreSlugAvailability",
    method: "get",
    path: "/v1/store-slugs/{slug}/availability",
    auth: "seller-session",
    responses: [
      { status: 200, schema: "SlugAvailability" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "previewStore",
    method: "get",
    path: "/v1/seller/store/preview",
    auth: "seller-session",
    responses: [
      { status: 200, schema: "StorePreview" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "StoreNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "publishStore",
    method: "post",
    path: "/v1/seller/store/publication",
    auth: "seller-session",
    responses: [
      { status: 200, schema: "StorePublication" },
      { status: 401, schema: "UnauthorizedError" },
      { status: 404, schema: "StoreNotFoundError" },
      { status: 409, schema: "SlugConflictError" },
      { status: 422, schema: "ValidationError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    operationId: "readPublishedStore",
    method: "get",
    path: "/v1/stores/{slug}",
    auth: "none",
    responses: [
      { status: 200, schema: "PublicStore" },
      { status: 404, schema: "StoreNotFoundError" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

export type OtpRequest = z.infer<typeof otpRequestContract>;
export type OtpChallenge = z.infer<typeof otpChallengeContract>;
export type OtpVerification = z.infer<typeof otpVerificationContract>;
export type SellerSession = z.infer<typeof sellerSessionContract>;
export type StoreDraftInput = z.infer<typeof storeDraftInputContract>;
export type StoreDraft = z.infer<typeof storeDraftContract>;
export type SlugAvailability = z.infer<typeof slugAvailabilityContract>;
export type StorePreview = z.infer<typeof storePreviewContract>;
export type PublicStore = z.infer<typeof publicStoreContract>;
export type StorePublication = z.infer<typeof storePublicationContract>;
