import * as apiErrorsV1 from "@sevo/contracts/api-errors/v1";
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
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ContractEvidence = {
  schemas: readonly string[];
  operations: readonly string[];
  events: readonly string[];
};

type ContractLifecycle = {
  contracts: Record<string, LifecycleStatus>;
  artifacts: Record<string, LifecycleStatus & { contract: string }>;
};

type LifecycleStatus = {
  owner: string;
  approved: boolean;
  executable: boolean;
  consumersMigrated: "complete" | "not-applicable" | "pending";
  removable: boolean;
  evidence: ContractEvidence;
};

const canonicalDomainEntrypoints: Record<string, Record<string, unknown>> = {
  "@sevo/contracts/identity-access/v1": identityAccessV1,
  "@sevo/contracts/store/v1": storeV1,
  "@sevo/contracts/product/v1": productV1,
  "@sevo/contracts/inventory/v1": inventoryV1,
  "@sevo/contracts/orders/v1": ordersV1,
  "@sevo/contracts/payments/v1": paymentsV1,
  "@sevo/contracts/fulfillment/v1": fulfillmentV1,
  "@sevo/contracts/conversations/v1": conversationsV1,
  "@sevo/contracts/problem-follow-up/v1": problemFollowUpV1,
  "@sevo/contracts/content/v1": contentV1,
  "@sevo/contracts/discovery/v1": discoveryV1,
  "@sevo/contracts/media/v1": mediaV1,
  "@sevo/contracts/notifications/v1": notificationsV1,
  "@sevo/contracts/reporting-analytics/v1": reportingAnalyticsV1,
  "@sevo/contracts/platform/v1": {
    errorEnvelopeV1Contract,
    eventEnvelopeV1Contract,
    moneyV1Contract,
  },
  "@sevo/contracts/api-errors/v1": apiErrorsV1,
};

const lifecycle = JSON.parse(
  readFileSync("docs/architecture/contract-lifecycle.json", "utf8"),
) as ContractLifecycle;

function expectSchema(value: unknown, label: string) {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).toHaveProperty("safeParse", expect.any(Function));
  const result = (
    value as { safeParse: (input: unknown) => { success: boolean } }
  ).safeParse(undefined);
  expect(result.success, label).toBe(false);
}

function expectEvent(value: unknown, label: string) {
  expectSchema(value, label);
  const result = (
    value as {
      safeParse: (input: unknown) => {
        success: boolean;
        error?: { issues: { path: PropertyKey[] }[] };
      };
    }
  ).safeParse({});
  expect(result.success, label).toBe(false);
  const missingFields = result.error?.issues.map(({ path }) => path[0]);
  expect(missingFields, label).toEqual(
    expect.arrayContaining(["eventId", "eventType", "version"]),
  );
}

function expectOperations(value: unknown, label: string) {
  expect(value, label).toBeTypeOf("object");
  const operations = Object.values(value as Record<string, unknown>);
  expect(operations.length, label).toBeGreaterThan(0);
  for (const operation of operations) {
    expect(operation, label).toMatchObject({
      operationId: expect.any(String),
      method: expect.stringMatching(/^(delete|get|post|put)$/),
      path: expect.stringMatching(/^\/(?:internal\/)?v1\//),
    });
  }
}

describe("canonical v1 contract entrypoints", () => {
  it("backs every executable lifecycle entry with real contract artifacts", () => {
    expect(Object.keys(lifecycle.contracts).sort()).toEqual(
      Object.keys(canonicalDomainEntrypoints).sort(),
    );

    for (const [contract, status] of Object.entries(lifecycle.contracts)) {
      expectLifecycleEvidence(contract, contract, status);
    }

    for (const [artifact, status] of Object.entries(lifecycle.artifacts)) {
      expectLifecycleEvidence(artifact, status.contract, status);
    }
  });

  function expectLifecycleEvidence(
    label: string,
    contract: string,
    status: LifecycleStatus,
  ) {
    const entrypoint = canonicalDomainEntrypoints[contract];
    expect(entrypoint, label).toBeDefined();

    const evidenceCount =
      status.evidence.schemas.length +
      status.evidence.operations.length +
      status.evidence.events.length;
    expect(evidenceCount > 0, label).toBe(status.executable);
    if (status.executable) expect(status.approved, label).toBe(true);
    if (status.removable) {
      expect(status.consumersMigrated, label).toBe("complete");
    }
    if (!status.approved) {
      expect(status.consumersMigrated, label).toBe("not-applicable");
    }

    for (const exportName of status.evidence.schemas) {
      expectSchema(entrypoint?.[exportName], `${label}#${exportName}`);
    }
    for (const exportName of status.evidence.operations) {
      expectOperations(entrypoint?.[exportName], `${label}#${exportName}`);
    }
    for (const exportName of status.evidence.events) {
      expectEvent(entrypoint?.[exportName], `${label}#${exportName}`);
    }
  }

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
