import { apiErrorV1Examples, apiErrorV1Schemas } from "@sevo/contracts/api-errors/v1";
import {
  identityStatusChangedV1Contract,
  identityAccessV1Examples,
  identityAccessV1Schemas,
} from "@sevo/contracts/identity-access/v1";
import { mediaV1Examples, mediaV1Schemas } from "@sevo/contracts/media/v1";
import { storeV1Examples, storeV1Schemas } from "@sevo/contracts/store/v1";
import { describe, expect, it } from "vitest";

const contractSchemas = {
  ...identityAccessV1Schemas,
  ...storeV1Schemas,
  ...mediaV1Schemas,
  ...apiErrorV1Schemas,
};
const contractExamples = {
  ...identityAccessV1Examples,
  ...storeV1Examples,
  ...mediaV1Examples,
  ...apiErrorV1Examples,
};

describe("identity and store shared schemas", () => {
  it("publishes a versioned identity status event for internal projections", () => {
    const event = identityStatusChangedV1Contract.parse({
      version: 1,
      eventId: "e47ac10b-58cc-4372-a567-0e02b2c3d479",
      eventType: "IdentityStatusChanged.v1",
      aggregateId: "8154cb9b-a8db-4a89-87f7-c14c27fefb3c",
      aggregateVersion: 2,
      occurredAt: "2026-08-24T09:30:00.000Z",
      correlationId: "a47ac10b-58cc-4372-a567-0e02b2c3d479",
      causationId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
      actor: { type: "SYSTEM" },
      payload: { status: "INACTIVE", statusVersion: 2 },
    });

    expect(event.payload).toEqual({ status: "INACTIVE", statusVersion: 2 });
    expect(JSON.stringify(event)).not.toMatch(/mobile|token/i);
  });

  it("publishes a canonical public identity session without mobile or roles", () => {
    const session = identityAccessV1Schemas.IdentitySession.parse({
      actor: {
        identityId: "8154cb9b-a8db-4a89-87f7-c14c27fefb3c",
        audience: "PUBLIC",
      },
      expiresAt: "2026-08-23T09:00:00.000Z",
    });

    expect(session).toEqual({
      actor: {
        identityId: "8154cb9b-a8db-4a89-87f7-c14c27fefb3c",
        audience: "PUBLIC",
      },
      expiresAt: "2026-08-23T09:00:00.000Z",
    });
    expect(JSON.stringify(session)).not.toMatch(/mobile|role/i);
  });

  it("accepts every published Persian request and response example", () => {
    for (const [schemaName, example] of Object.entries(contractExamples)) {
      expect(
        contractSchemas[schemaName].safeParse(example),
        `${schemaName} example must satisfy its shared schema`,
      ).toMatchObject({ success: true });
    }
  });

  it("rejects a non-Iranian mobile number and malformed store slug", () => {
    expect(
      identityAccessV1Schemas.OtpRequest.safeParse({ mobile: "12345" }).success,
    ).toBe(false);
    expect(
      storeV1Schemas.StoreDraftInput.safeParse({
        ...storeV1Examples.StoreDraftInput,
        slug: "فروشگاه من",
      }).success,
    ).toBe(false);
  });

  it("allows an incomplete draft and omitted visual customization", () => {
    expect(
      storeV1Schemas.StoreDraftInput.safeParse({
        name: "خانه سفال ماه",
      }),
    ).toMatchObject({ success: true });
  });

  it("rejects an incomplete store once its status is published", () => {
    expect(
      storeV1Schemas.StoreDraft.safeParse({
        id: "5f683499-e223-4b79-b353-0a75c7261b71",
        name: "خانه سفال ماه",
        status: "PUBLISHED",
        updatedAt: "2026-08-16T09:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
