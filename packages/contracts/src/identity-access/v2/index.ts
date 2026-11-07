import { z } from "zod";
import { platformAgentSessionContract } from "../v1/index";
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
export const platformAgentAuthV2Paths = {
  requestOtp: "/v2/platform/auth/otp/requests",
  verifyOtp: "/v2/platform/auth/otp/verifications",
} as const;
export const identityAccessV2Schemas = {
  PlatformAgentSessionV2: platformAgentSessionV2Contract,
};
export const identityAccessV2Examples = {
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
