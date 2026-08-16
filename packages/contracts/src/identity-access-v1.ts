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

export const sellerSessionContract = z.object({
  seller: z.object({
    id: z.string().uuid(),
    mobile: iranianMobileContract,
  }),
  expiresAt: z.string().datetime({ offset: true }),
});

export const unauthorizedErrorContract = z.object({
  code: z.literal("UNAUTHORIZED"),
  message: z.string().min(1),
  correlationId: z.string().min(1),
});

export const identityAccessV1Schemas = {
  OtpRequest: otpRequestContract,
  OtpChallenge: otpChallengeContract,
  OtpVerification: otpVerificationContract,
  SellerSession: sellerSessionContract,
  UnauthorizedError: unauthorizedErrorContract,
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
  SellerSession: {
    seller: {
      id: "8154cb9b-a8db-4a89-87f7-c14c27fefb3c",
      mobile: "09123456789",
    },
    expiresAt: "2026-08-23T09:00:00.000Z",
  },
  UnauthorizedError: {
    code: "UNAUTHORIZED",
    message: "نشست فروشنده معتبر نیست",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
} as const;

export type IranianMobile = z.infer<typeof iranianMobileContract>;
export type OtpCode = z.infer<typeof otpCodeContract>;
export type OtpChallengeId = z.infer<typeof otpChallengeIdContract>;
export type OtpRequest = z.infer<typeof otpRequestContract>;
export type OtpChallenge = z.infer<typeof otpChallengeContract>;
export type OtpVerification = z.infer<typeof otpVerificationContract>;
export type SellerSession = z.infer<typeof sellerSessionContract>;
