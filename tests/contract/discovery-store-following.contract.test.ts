import {
  createDiscoveryV1JsonSchemas,
  publicFollowerCountV1Contract,
  storeFollowActivatedV1Contract,
  storeFollowDeactivatedV1Contract,
  storeFollowViewV1Contract,
} from "@sevo/contracts/discovery/v1";
import { describe, expect, it } from "vitest";

const storeId = "c47ac10b-58cc-4372-a567-0e02b2c3d479";
const eventId = "d47ac10b-58cc-4372-a567-0e02b2c3d479";
const correlationId = "e47ac10b-58cc-4372-a567-0e02b2c3d479";
const occurredAt = "2026-08-24T08:30:00.000Z";

describe("discovery store-following v1 contract", () => {
  it("publishes the relationship and public count without follower identity", () => {
    const follow = storeFollowViewV1Contract.parse({
      version: 1,
      storeId,
      status: "ACTIVE",
      revision: 1,
      followSetRevision: 1,
      activatedAt: occurredAt,
    });
    const count = publicFollowerCountV1Contract.parse({
      version: 1,
      storeId,
      count: 1,
      updatedAt: occurredAt,
    });

    expect(follow.status).toBe("ACTIVE");
    expect(count.count).toBe(1);
    expect(JSON.stringify({ follow, count })).not.toMatch(/identity|mobile/i);
    expect(createDiscoveryV1JsonSchemas()).toHaveProperty("StoreFollowViewV1");
    expect(createDiscoveryV1JsonSchemas()).toHaveProperty("PublicFollowerCountV1");
  });

  it.each([
    [storeFollowActivatedV1Contract, "StoreFollowActivated.v1"],
    [storeFollowDeactivatedV1Contract, "StoreFollowDeactivated.v1"],
  ])("keeps %s event payload free of PII", (contract, eventType) => {
    const event = contract.parse({
      version: 1,
      eventId,
      eventType,
      aggregateId: storeId,
      aggregateVersion: 1,
      occurredAt,
      correlationId,
      actor: { type: "SYSTEM" },
      payload: { storeId, relationRevision: 1, followSetRevision: 1 },
    });

    expect(JSON.stringify(event.payload)).not.toMatch(/identity|mobile/i);
  });
});
