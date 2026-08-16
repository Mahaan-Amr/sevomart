import { z } from "zod";

import { createJsonSchemaMap } from "./json-schema";

export const mediaIdContract = z.string().uuid().brand<"MediaId">();

export const mediaUploadInputContract = z.object({
  fileName: z.string().min(1).max(120),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  contentBase64: z.string().min(1).max(8_000_000),
});

export const mediaReferenceContract = z.object({
  id: mediaIdContract,
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  url: z.string().regex(/^\/v1\/media\/[0-9a-f-]{36}$/),
});

export const mediaNotFoundErrorContract = z.object({
  code: z.literal("MEDIA_NOT_FOUND"),
  message: z.string().min(1),
  correlationId: z.string().min(1),
});

export const mediaV1Schemas = {
  MediaId: mediaIdContract,
  MediaUploadInput: mediaUploadInputContract,
  MediaReference: mediaReferenceContract,
  MediaNotFoundError: mediaNotFoundErrorContract,
} as const;

export function createMediaV1JsonSchemas() {
  return createJsonSchemaMap(mediaV1Schemas);
}

export const mediaV1Examples = {
  MediaId: "6014fdd4-e393-4100-a037-030b781b6637",
  MediaUploadInput: {
    fileName: "نشان-فروشگاه.webp",
    contentType: "image/webp",
    contentBase64: "UklGRg==",
  },
  MediaReference: {
    id: "6014fdd4-e393-4100-a037-030b781b6637",
    contentType: "image/webp",
    url: "/v1/media/6014fdd4-e393-4100-a037-030b781b6637",
  },
  MediaNotFoundError: {
    code: "MEDIA_NOT_FOUND",
    message: "رسانه پیدا نشد",
    correlationId: "01J5H8CZHJ2QX0M5MEQ7M6H1P4",
  },
} as const;

export type MediaId = z.infer<typeof mediaIdContract>;
export type MediaUploadInput = z.infer<typeof mediaUploadInputContract>;
export type MediaReference = z.infer<typeof mediaReferenceContract>;
