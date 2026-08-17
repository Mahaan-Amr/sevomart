import { z } from "zod";

import { createJsonSchemaMap } from "./json-schema";

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
        code: z.enum([
          "REQUIRED",
          "INVALID_FORMAT",
          "TOO_SHORT",
          "TOO_LONG",
          "FILE_TOO_LARGE",
          "IMAGE_TOO_LARGE",
          "CORRUPT_IMAGE",
          "UNSUPPORTED_FORMAT",
          "ANIMATED_IMAGE",
          "MIME_MISMATCH",
          "RATE_LIMITED",
        ]),
      }),
    ),
  }),
});

export const internalServerErrorContract = z.object({
  code: z.literal("INTERNAL_SERVER_ERROR"),
  ...errorBase,
});

export const apiErrorV1Schemas = {
  ValidationError: validationErrorContract,
  InternalServerError: internalServerErrorContract,
} as const;

export function createApiErrorV1JsonSchemas() {
  return createJsonSchemaMap(apiErrorV1Schemas);
}

export const apiErrorV1Examples = {
  ValidationError: {
    code: "VALIDATION_ERROR",
    message: "اعتبارسنجی درخواست ناموفق بود",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
    details: { issues: [{ field: "slug", code: "INVALID_FORMAT" }] },
  },
  InternalServerError: {
    code: "INTERNAL_SERVER_ERROR",
    message: "خطای پیش‌بینی‌نشده سرور رخ داد",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
} as const;
