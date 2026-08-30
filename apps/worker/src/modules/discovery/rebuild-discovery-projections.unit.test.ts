import { describe, expect, it, vi } from "vitest";

import { rebuildDiscoveryProjections } from "./rebuild-discovery-projections";

describe("combined discovery projection rebuild", () => {
  it("keeps the completed follower-count rebuild visible when public-feed rebuild fails", async () => {
    const calls: string[] = [];
    const failure = new Error("public feed replay failed");

    await expect(
      rebuildDiscoveryProjections("database-url", {
        rebuildFollowerCount: vi.fn(async () => {
          calls.push("follower-count");
          return { replayedEventCount: 3 };
        }),
        rebuildPublicFeed: vi.fn(async () => {
          calls.push("public-feed");
          throw failure;
        }),
      }),
    ).rejects.toBe(failure);
    expect(calls).toEqual(["follower-count", "public-feed"]);
  });
});
