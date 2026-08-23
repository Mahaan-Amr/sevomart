import { z } from "zod";

import { createJsonSchemaMap } from "./json-schema";

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
} as const;

export type IranianMobile = z.infer<typeof iranianMobileContract>;
export type OtpCode = z.infer<typeof otpCodeContract>;
export type OtpChallengeId = z.infer<typeof otpChallengeIdContract>;
export type OtpRequest = z.infer<typeof otpRequestContract>;
export type OtpChallenge = z.infer<typeof otpChallengeContract>;
export type OtpVerification = z.infer<typeof otpVerificationContract>;
export type ActorContext = z.infer<typeof actorContextContract>;
export type IdentitySession = z.infer<typeof identitySessionContract>;
