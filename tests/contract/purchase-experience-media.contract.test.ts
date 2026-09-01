import {
  MEDIA_UPLOAD_PURPOSES,
  PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS,
  mediaUploadInputContract,
  purchaseExperienceMediaUploadInputContract,
  purchaseExperienceMediaUploadPurpose,
} from "@sevo/contracts/media/v1";
import { expect, it } from "vitest";

it("publishes a dedicated buyer image contract without reusing seller purposes", () => {
  expect(purchaseExperienceMediaUploadPurpose).toBe("PURCHASE_EXPERIENCE_IMAGE");
  expect(MEDIA_UPLOAD_PURPOSES).not.toContain(purchaseExperienceMediaUploadPurpose);
  expect(PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS).toBe(4);
  expect(purchaseExperienceMediaUploadInputContract.parse({ file: "binary" })).toEqual({
    file: "binary",
  });
  expect(
    purchaseExperienceMediaUploadInputContract.safeParse({
      file: "binary",
      purpose: "PRODUCT_IMAGE",
      orderItemId: "50000000-0000-4000-8000-000000000001",
    }).success,
  ).toBe(false);
  expect(
    mediaUploadInputContract.safeParse({
      purpose: purchaseExperienceMediaUploadPurpose,
      file: "binary",
    }).success,
  ).toBe(false);
});
