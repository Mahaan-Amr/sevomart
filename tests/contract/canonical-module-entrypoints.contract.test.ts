import * as contentV1 from "@sevo/contracts/content/v1";
import * as conversationsV1 from "@sevo/contracts/conversations/v1";
import * as discoveryV1 from "@sevo/contracts/discovery/v1";
import * as fulfillmentV1 from "@sevo/contracts/fulfillment/v1";
import * as identityAccessV1 from "@sevo/contracts/identity-access/v1";
import * as inventoryV1 from "@sevo/contracts/inventory/v1";
import * as mediaV1 from "@sevo/contracts/media/v1";
import * as notificationsV1 from "@sevo/contracts/notifications/v1";
import * as ordersV1 from "@sevo/contracts/orders/v1";
import * as paymentsV1 from "@sevo/contracts/payments/v1";
import {
  errorEnvelopeV1Contract,
  eventEnvelopeV1Contract,
  moneyV1Contract,
} from "@sevo/contracts/platform/v1";
import * as problemFollowUpV1 from "@sevo/contracts/problem-follow-up/v1";
import * as productV1 from "@sevo/contracts/product/v1";
import * as reportingAnalyticsV1 from "@sevo/contracts/reporting-analytics/v1";
import * as storeV1 from "@sevo/contracts/store/v1";
import { describe, expect, it } from "vitest";

const canonicalDomainEntrypoints = [
  identityAccessV1,
  storeV1,
  productV1,
  inventoryV1,
  ordersV1,
  paymentsV1,
  fulfillmentV1,
  conversationsV1,
  problemFollowUpV1,
  contentV1,
  discoveryV1,
  mediaV1,
  notificationsV1,
  reportingAnalyticsV1,
];

describe("canonical v1 contract entrypoints", () => {
  it("keeps every registered module importable before fan-out", () => {
    expect(canonicalDomainEntrypoints).toHaveLength(14);
    for (const entrypoint of canonicalDomainEntrypoints) {
      expect(entrypoint).toBeTypeOf("object");
    }
  });

  it("validates platform money and envelopes independently of domain modules", () => {
    expect(moneyV1Contract.parse({ amount: 125_000, currency: "IRR" })).toEqual({
      amount: 125_000,
      currency: "IRR",
    });
    expect(() => moneyV1Contract.parse({ amount: -1, currency: "IRR" })).toThrow();

    expect(
      errorEnvelopeV1Contract.parse({
        version: 1,
        code: "CONFLICT",
        message: "درخواست با وضعیت فعلی سازگار نیست.",
        correlationId: "a47ac10b-58cc-4372-a567-0e02b2c3d479",
      }),
    ).toMatchObject({ version: 1, code: "CONFLICT" });

    expect(
      eventEnvelopeV1Contract.parse({
        version: 1,
        eventId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
        eventType: "ProductPublished.v2",
        aggregateId: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
        aggregateVersion: 2,
        occurredAt: "2026-08-23T12:00:00+03:30",
        correlationId: "d47ac10b-58cc-4372-a567-0e02b2c3d479",
        actor: {
          type: "IDENTITY",
          id: "e47ac10b-58cc-4372-a567-0e02b2c3d479",
        },
      }),
    ).toMatchObject({ eventType: "ProductPublished.v2", aggregateVersion: 2 });

    expect(
      eventEnvelopeV1Contract.parse({
        version: 1,
        eventId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
        eventType: "LegacyEvent.v1",
        aggregateId: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
        aggregateVersion: 1,
        occurredAt: "2026-08-23T12:00:00+03:30",
        correlationId: "d47ac10b-58cc-4372-a567-0e02b2c3d479",
      }),
    ).toMatchObject({ eventType: "LegacyEvent.v1" });
  });

  it("keeps StorePublished.v1 PII-free and versioned", () => {
    expect(
      storeV1.storePublishedV1Contract.parse({
        version: 1,
        eventId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
        eventType: "StorePublished.v1",
        aggregateId: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
        aggregateVersion: 1,
        occurredAt: "2026-08-23T12:00:00+03:30",
        correlationId: "d47ac10b-58cc-4372-a567-0e02b2c3d479",
        actor: {
          type: "IDENTITY",
          id: "e47ac10b-58cc-4372-a567-0e02b2c3d479",
        },
        payload: {
          storeId: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
          publicationStatus: "PUBLISHED",
        },
      }),
    ).toMatchObject({
      eventType: "StorePublished.v1",
      payload: { publicationStatus: "PUBLISHED" },
    });
  });
});
