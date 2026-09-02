import type { MediaVariant } from "@sevo/contracts/media/v1";

import type { StoredMediaPurpose } from "./public";

export type MediaVariantDefinition = readonly [
  name: MediaVariant,
  width: number,
  height: number | undefined,
  lossless: boolean,
];

const attachmentPreview = [
  ["attachment-preview", 1600, 1600, false],
] as const satisfies readonly MediaVariantDefinition[];

const policies = {
  STORE_LOGO: {
    requiresOwnerReference: false,
    visibilityCanChange: true,
    canonicalVariant: "logo-large",
    variants: [
      ["logo-small", 128, 128, true],
      ["logo-large", 512, 512, true],
    ],
  },
  STORE_COVER: {
    requiresOwnerReference: false,
    visibilityCanChange: true,
    canonicalVariant: "cover-desktop",
    variants: [
      ["cover-mobile", 960, undefined, false],
      ["cover-desktop", 1920, undefined, false],
    ],
  },
  PRODUCT_IMAGE: {
    requiresOwnerReference: false,
    visibilityCanChange: true,
    canonicalVariant: "product-detail",
    variants: [
      ["product-card", 640, 640, false],
      ["product-detail", 1600, 1600, false],
    ],
  },
  CONVERSATION_ATTACHMENT: {
    requiresOwnerReference: true,
    visibilityCanChange: false,
    canonicalVariant: "attachment-preview",
    variants: attachmentPreview,
  },
  DISPUTE_EVIDENCE: {
    requiresOwnerReference: true,
    visibilityCanChange: false,
    canonicalVariant: "attachment-preview",
    variants: attachmentPreview,
  },
  BUYER_DISPUTE_EVIDENCE: {
    requiresOwnerReference: true,
    visibilityCanChange: false,
    canonicalVariant: "attachment-preview",
    variants: attachmentPreview,
  },
  PURCHASE_EXPERIENCE_IMAGE: {
    requiresOwnerReference: true,
    visibilityCanChange: false,
    canonicalVariant: "attachment-preview",
    variants: attachmentPreview,
  },
} as const satisfies Record<
  StoredMediaPurpose,
  {
    requiresOwnerReference: boolean;
    visibilityCanChange: boolean;
    canonicalVariant: MediaVariant;
    variants: readonly MediaVariantDefinition[];
  }
>;

export function mediaPurposePolicy(purpose: StoredMediaPurpose) {
  return policies[purpose];
}

export const privateContextMediaPurposes = Object.entries(policies)
  .filter(([, policy]) => policy.requiresOwnerReference)
  .map(([purpose]) => purpose) as StoredMediaPurpose[];
