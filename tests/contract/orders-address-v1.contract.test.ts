import {
  createSavedAddressInputContract,
  savedAddressContract,
  updateSavedAddressInputContract,
} from "@sevo/contracts/orders/v1";
import { describe, expect, it } from "vitest";

const address = {
  recipientName: "سارا احمدی",
  recipientMobile: "09123456789",
  provinceText: "تهران",
  cityText: "تهران",
  addressLine: "خیابان آزادی، کوچه بهار، پلاک ۱۲",
  postalCode: "1234567890",
};

describe("SavedAddress.v1 contract", () => {
  it("accepts a Persian delivery address and normalizes contact digits", () => {
    expect(
      createSavedAddressInputContract.parse({
        ...address,
        recipientMobile: "۰۹۱۲۳۴۵۶۷۸۹",
        postalCode: "۱۲۳۴۵۶۷۸۹۰",
      }),
    ).toEqual(address);
  });

  it("requires a revision for edits and rejects incomplete human input", () => {
    expect(
      updateSavedAddressInputContract.parse({ ...address, expectedRevision: 2 }),
    ).toEqual({ ...address, expectedRevision: 2 });
    expect(
      createSavedAddressInputContract.safeParse({ ...address, cityText: "" }).success,
    ).toBe(false);
    expect(
      createSavedAddressInputContract.safeParse({
        ...address,
        recipientMobile: "02112345678",
      }).success,
    ).toBe(false);
  });

  it("returns one current revision without persistence metadata", () => {
    const parsed = savedAddressContract.parse({
      addressId: "0fe9edc9-e3b7-47d5-a3d0-290de59d118e",
      revision: 3,
      ...address,
    });
    expect(parsed.revision).toBe(3);
    expect(parsed).not.toHaveProperty("identityId");
  });
});
