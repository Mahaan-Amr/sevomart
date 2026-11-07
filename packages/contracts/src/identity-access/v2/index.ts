import { z } from "zod";
import {
  platformAgentSessionContract,
  superadminGrantInputContract,
  sessionSecurityRevocationRequestContract,
} from "../v1/index";
import { createJsonSchemaMap } from "../../json-schema";
export const platformAgentSessionV2Contract = z.union([
  platformAgentSessionContract,
  z
    .object({
      actor: z.object({
        identityId: z.string().uuid(),
        audience: z.literal("PLATFORM_AGENT"),
      }),
      role: z.literal("SUPERADMIN"),
      expiresAt: z.string().datetime({ offset: true }),
    })
    .strict(),
]);
export const platformPasswordLoginContract = z
  .object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(128),
  })
  .strict();
export const platformPasswordRecoveryRequestContract = superadminGrantInputContract
  .extend({
    username: z
      .string()
      .regex(/^[a-z][a-z0-9._-]{2,99}$/)
      .optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
  })
  .strict();
export const platformPasswordRecoveryContract = z
  .object({
    code: z.string().regex(/^[A-Za-z0-9۰-۹٠-٩_-]{43}$/),
    password: z.string().min(12).max(128),
  })
  .strict();
export const platformPasswordRecoveryIssuedContract = z
  .object({
    code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const platformPasswordSessionRevocationContract =
  sessionSecurityRevocationRequestContract.omit({ proof: true });
export const platformAgentAuthV2Paths = {
  passwordSession: "/v2/platform/auth/password/sessions",
  passwordRecoveryRequest: "/v2/platform/auth/password/recovery-requests",
  passwordRecovery: "/v2/platform/auth/password/recovery",
  passwordSessionRevocation: "/v2/platform/security/session-revocations",
  requestOtp: "/v2/platform/auth/otp/requests",
  verifyOtp: "/v2/platform/auth/otp/verifications",
} as const;
export const identityAccessV2Schemas = {
  PlatformAgentSessionV2: platformAgentSessionV2Contract,
  PlatformPasswordLogin: platformPasswordLoginContract,
  PlatformPasswordRecoveryRequest: platformPasswordRecoveryRequestContract,
  PlatformPasswordRecovery: platformPasswordRecoveryContract,
  PlatformPasswordRecoveryIssued: platformPasswordRecoveryIssuedContract,
  PlatformPasswordSessionRevocation: platformPasswordSessionRevocationContract,
};
export const identityAccessV2Examples = {
  PlatformPasswordLogin: { identifier: "example-admin", password: "example-password" },
  PlatformPasswordRecoveryRequest: {
    identityId: "11111111-1111-4111-8111-111111111111",
    reason: "بازیابی دسترسی همکار",
    username: "example-colleague",
  },
  PlatformPasswordRecovery: {
    code: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    password: "example-password",
  },
  PlatformPasswordRecoveryIssued: {
    code: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    expiresAt: "2026-08-27T09:00:00.000Z",
  },
  PlatformPasswordSessionRevocation: {
    targetIdentityId: "11111111-1111-4111-8111-111111111111",
    incidentId: "incident-example",
    reason: "security incident",
  },
  PlatformAgentSessionV2: {
    actor: {
      identityId: "11111111-1111-4111-8111-111111111111",
      audience: "PLATFORM_AGENT",
    },
    role: "SUPERADMIN",
    expiresAt: "2026-08-27T09:00:00.000Z",
  },
} as const;
export function createIdentityAccessV2JsonSchemas() {
  return createJsonSchemaMap(identityAccessV2Schemas);
}
