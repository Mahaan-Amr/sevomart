import { z } from "zod";

import { createJsonSchemaMap } from "./json-schema";

export const mediaIdContract = z.string().uuid().brand<"MediaId">();

export const MEDIA_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_UPLOAD_MAX_PIXELS = 24_000_000;
export const MEDIA_UPLOAD_ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const MEDIA_UPLOAD_PURPOSES = ["STORE_LOGO", "STORE_COVER"] as const;
export const MEDIA_VARIANTS = [
  "logo-small",
  "logo-large",
  "cover-mobile",
  "cover-desktop",
] as const;

export const mediaUploadPurposeContract = z.enum(MEDIA_UPLOAD_PURPOSES);
export const mediaUploadInputContract = z.object({
  purpose: mediaUploadPurposeContract,
  file: z.string().min(1),
});

export const mediaReferenceContract = z.object({
  id: mediaIdContract,
  contentType: z.literal("image/webp"),
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
    purpose: "STORE_LOGO",
    file: "(binary)",
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
export type MediaUploadPurpose = z.infer<typeof mediaUploadPurposeContract>;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];
export type MediaReference = z.infer<typeof mediaReferenceContract>;
