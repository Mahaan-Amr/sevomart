import { z } from "zod";

import { validationErrorContract } from "./api-errors-v1";
import { createJsonSchemaMap } from "./json-schema";
import { eventEnvelopeV1Contract } from "./platform/v1";

export const iranianMobileContract = z
  .string()
  .regex(/^09\d{9}$/)
  .brand<"IranianMobile">();
export const otpCodeContract = z
  .string()
  .regex(/^\d{6}$/)
  .brand<"OtpCode">();
export const otpChallengeIdContract = z.string().uuid().brand<"OtpChallengeId">();

export const identityAccessV1Paths = {
  requestOtp: "/v1/auth/otp/requests",
  verifyOtp: "/v1/auth/otp/verifications",
  readSession: "/v1/auth/session",
  endSession: "/v1/auth/session",
} as const;

export const sellerApplicationV1Paths = {
  submit: "/v1/seller-applications",
  readMine: "/v1/seller-applications/mine",
  resubmit: "/v1/seller-applications/{applicationId}/resubmission",
  withdraw: "/v1/seller-applications/{applicationId}/withdrawal",
} as const;

const trimmedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum);

export const sellerApplicationInputContract = z.object({
  applicantName: trimmedText(2, 80),
  proposedStoreName: trimmedText(2, 80),
  goodsAreaText: trimmedText(2, 120),
  currentSalesMethod: trimmedText(2, 240),
});

export const sellerApplicationStatusContract = z.enum([
  "SUBMITTED",
  "NEEDS_INFORMATION",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
]);

export const sellerApplicationIdContract = z
  .string()
  .uuid()
  .brand<"SellerApplicationId">();
export const idempotencyKeyContract = z.string().uuid().brand<"IdempotencyKey">();
export const sellerApplicationCursorContract = z.string().min(1).max(500);
export const sellerApplicationPageLimitContract = z.number().int().min(1).max(50);

export const sellerApplicationRequestedFieldContract = z.enum([
  "applicantName",
  "proposedStoreName",
  "goodsAreaText",
  "currentSalesMethod",
]);

export const sellerApplicationReasonCodeContract = z.enum([
  "INFORMATION_INCOMPLETE",
  "INFORMATION_INCONSISTENT",
  "ELIGIBILITY_CONFIRMED",
  "ELIGIBILITY_NOT_ESTABLISHED",
  "OTHER",
]);

export const resubmitSellerApplicationContract = sellerApplicationInputContract.extend({
  expectedRevision: z.number().int().positive(),
});

export const withdrawSellerApplicationContract = z.object({
  expectedRevision: z.number().int().positive(),
});

export const readMySellerApplicationsQueryContract = z.object({
  cursor: sellerApplicationCursorContract.optional(),
  limit: sellerApplicationPageLimitContract.default(20),
});

export const sellerApplicationTimelineEntryContract = z.object({
  revision: z.number().int().positive(),
  status: sellerApplicationStatusContract,
  title: z.string().min(1),
  publicReason: z.string().min(5).max(1_000).nullable(),
  reasonCode: sellerApplicationReasonCodeContract.nullable(),
  requestedFields: z.array(sellerApplicationRequestedFieldContract),
  occurredAt: z.string().datetime({ offset: true }),
});

export const sellerApplicationNextStepContract = z.enum([
  "WAIT_FOR_REVIEW",
  "PROVIDE_INFORMATION",
  "START_SELLER_WORKSPACE",
  "APPLICATION_ENDED",
]);

export const sellerApplicationViewContract = z.object({
  applicationId: sellerApplicationIdContract,
  status: sellerApplicationStatusContract,
  currentRevision: z.number().int().positive(),
  currentPayload: sellerApplicationInputContract,
  nextStep: sellerApplicationNextStepContract,
  createdAt: z.string().datetime({ offset: true }),
  lastSubmittedAt: z.string().datetime({ offset: true }),
  timeline: z.array(sellerApplicationTimelineEntryContract),
});

export const mySellerApplicationsContract = z.object({
  items: z.array(sellerApplicationViewContract),
  nextCursor: z.string().nullable(),
});

export const sellerApplicationErrorContract = z.object({
  code: z.enum([
    "APPLICATION_NOT_FOUND",
    "ACTIVE_APPLICATION_EXISTS",
    "SELLER_ALREADY_ACTIVE",
    "INVALID_APPLICATION_TRANSITION",
    "APPLICATION_REVISION_CONFLICT",
    "IDEMPOTENCY_CONFLICT",
    "IDEMPOTENCY_IN_PROGRESS",
    "INVALID_CURSOR",
  ]),
  message: z.string().min(1),
  correlationId: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const sellerApplicationReadMineErrorContract = z.union([
  sellerApplicationErrorContract,
  validationErrorContract,
]);

const sellerApplicationEventPayloadContract = z
  .object({
    applicationId: z.string().uuid(),
    identityId: z.string().uuid(),
    status: sellerApplicationStatusContract,
    revision: z.number().int().positive(),
    actorKind: z.literal("APPLICANT"),
  })
  .strict();

export const sellerApplicationEventContract = eventEnvelopeV1Contract
  .extend({
    eventType: z.enum([
      "SellerApplicationSubmitted.v1",
      "SellerApplicationResubmitted.v1",
      "SellerApplicationWithdrawn.v1",
    ]),
    actor: z.object({ type: z.literal("IDENTITY"), id: z.string().uuid() }).strict(),
    payload: sellerApplicationEventPayloadContract,
  })
  .strict();

export const otpRequestContract = z.object({
  mobile: iranianMobileContract,
});

export const otpChallengeContract = z.object({
  challengeId: otpChallengeIdContract,
  expiresAt: z.string().datetime({ offset: true }),
});

export const otpVerificationContract = z.object({
  challengeId: otpChallengeIdContract,
  code: otpCodeContract,
});

export const actorContextContract = z.object({
  identityId: z.string().uuid(),
  audience: z.literal("PUBLIC"),
});

export const identitySessionContract = z.object({
  actor: actorContextContract,
  expiresAt: z.string().datetime({ offset: true }),
});

export const unauthorizedErrorContract = z.object({
  code: z.literal("UNAUTHORIZED"),
  message: z.string().min(1),
  correlationId: z.string().min(1),
});

export const rateLimitErrorContract = z.object({
  code: z.literal("RATE_LIMITED"),
  message: z.string().min(1),
  correlationId: z.string().min(1),
});

export const identityAccessV1Schemas = {
  OtpRequest: otpRequestContract,
  OtpChallenge: otpChallengeContract,
  OtpVerification: otpVerificationContract,
  ActorContext: actorContextContract,
  IdentitySession: identitySessionContract,
  UnauthorizedError: unauthorizedErrorContract,
  RateLimitError: rateLimitErrorContract,
  SellerApplicationId: sellerApplicationIdContract,
  IdempotencyKey: idempotencyKeyContract,
  SellerApplicationCursor: sellerApplicationCursorContract,
  SellerApplicationPageLimit: sellerApplicationPageLimitContract,
  SellerApplicationInput: sellerApplicationInputContract,
  ResubmitSellerApplication: resubmitSellerApplicationContract,
  WithdrawSellerApplication: withdrawSellerApplicationContract,
  SellerApplicationTimelineEntry: sellerApplicationTimelineEntryContract,
  SellerApplicationView: sellerApplicationViewContract,
  MySellerApplications: mySellerApplicationsContract,
  SellerApplicationError: sellerApplicationErrorContract,
  SellerApplicationReadMineError: sellerApplicationReadMineErrorContract,
} as const;

export function createIdentityAccessV1JsonSchemas() {
  return createJsonSchemaMap(identityAccessV1Schemas);
}

export const identityAccessV1Examples = {
  OtpRequest: { mobile: "09123456789" },
  OtpChallenge: {
    challengeId: "5efea92d-e15f-454e-bc29-0368f667a21d",
    expiresAt: "2026-08-16T09:05:00.000Z",
  },
  OtpVerification: {
    challengeId: "5efea92d-e15f-454e-bc29-0368f667a21d",
    code: "111111",
  },
  ActorContext: {
    identityId: "8154cb9b-a8db-4a89-87f7-c14c27fefb3c",
    audience: "PUBLIC",
  },
  IdentitySession: {
    actor: {
      identityId: "8154cb9b-a8db-4a89-87f7-c14c27fefb3c",
      audience: "PUBLIC",
    },
    expiresAt: "2026-08-23T09:00:00.000Z",
  },
  UnauthorizedError: {
    code: "UNAUTHORIZED",
    message: "نشست شما معتبر نیست. دوباره وارد شوید.",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
  RateLimitError: {
    code: "RATE_LIMITED",
    message: "درخواست‌ها زیاد شده است؛ کمی بعد دوباره تلاش کنید.",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
  SellerApplicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
  IdempotencyKey: "74155020-2830-43a5-9bc1-d5bb7a7fead8",
  SellerApplicationCursor: "eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTI0VDA4OjAwOjAwLjAwMFoifQ",
  SellerApplicationPageLimit: 20,
  SellerApplicationReadMineError: {
    code: "INVALID_CURSOR",
    message: "ادامه فهرست درخواست‌ها معتبر نیست.",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
  SellerApplicationInput: {
    applicantName: "نگار محمدی",
    proposedStoreName: "خانه ماه",
    goodsAreaText: "سفال دست‌ساز",
    currentSalesMethod: "فروش از راه اینستاگرام و پیام مستقیم",
  },
  ResubmitSellerApplication: {
    applicantName: "نگار محمدی",
    proposedStoreName: "خانه ماه",
    goodsAreaText: "سفال دست‌ساز",
    currentSalesMethod: "فروش از راه اینستاگرام و پیام مستقیم",
    expectedRevision: 1,
  },
  WithdrawSellerApplication: { expectedRevision: 1 },
  SellerApplicationTimelineEntry: {
    revision: 1,
    status: "SUBMITTED",
    title: "درخواست ثبت شد",
    publicReason: null,
    reasonCode: null,
    requestedFields: [],
    occurredAt: "2026-08-24T08:00:00.000Z",
  },
  SellerApplicationView: {
    applicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
    status: "SUBMITTED",
    currentRevision: 1,
    currentPayload: {
      applicantName: "نگار محمدی",
      proposedStoreName: "خانه ماه",
      goodsAreaText: "سفال دست‌ساز",
      currentSalesMethod: "فروش از راه اینستاگرام و پیام مستقیم",
    },
    nextStep: "WAIT_FOR_REVIEW",
    createdAt: "2026-08-24T08:00:00.000Z",
    lastSubmittedAt: "2026-08-24T08:00:00.000Z",
    timeline: [],
  },
  MySellerApplications: { items: [], nextCursor: null },
  SellerApplicationError: {
    code: "ACTIVE_APPLICATION_EXISTS",
    message: "یک درخواست در حال بررسی دارید.",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
} as const;

export type IranianMobile = z.infer<typeof iranianMobileContract>;
export type OtpCode = z.infer<typeof otpCodeContract>;
export type OtpChallengeId = z.infer<typeof otpChallengeIdContract>;
export type OtpRequest = z.infer<typeof otpRequestContract>;
export type OtpChallenge = z.infer<typeof otpChallengeContract>;
export type OtpVerification = z.infer<typeof otpVerificationContract>;
export type ActorContext = z.infer<typeof actorContextContract>;
export type IdentitySession = z.infer<typeof identitySessionContract>;
export type SellerApplicationInput = z.infer<typeof sellerApplicationInputContract>;
export type SellerApplicationStatus = z.infer<typeof sellerApplicationStatusContract>;
export type SellerApplicationEvent = z.infer<typeof sellerApplicationEventContract>;
export type SellerApplicationId = z.infer<typeof sellerApplicationIdContract>;
export type ResubmitSellerApplication = z.infer<
  typeof resubmitSellerApplicationContract
>;
export type WithdrawSellerApplication = z.infer<
  typeof withdrawSellerApplicationContract
>;
export type ReadMySellerApplicationsQuery = z.infer<
  typeof readMySellerApplicationsQueryContract
>;
export type SellerApplicationView = z.infer<typeof sellerApplicationViewContract>;
export type MySellerApplications = z.infer<typeof mySellerApplicationsContract>;
