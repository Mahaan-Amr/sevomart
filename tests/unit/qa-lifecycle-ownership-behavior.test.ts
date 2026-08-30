import { describe, expect, it } from "vitest";

import { runOwnedQaStartup } from "../../scripts/qa/startup-ownership.mjs";

describe("QA lifecycle ownership behavior", () => {
  it("allows only the claim owner to start and perform destructive cleanup", async () => {
    const events: Array<{ contender: string; operation: string }> = [];
    let owner: string | undefined;

    const start = (contender: string) =>
      runOwnedQaStartup({
        acquireOwnership: async () => {
          if (owner) throw new Error("already owned");
          owner = contender;
          events.push({ contender, operation: "claim" });
          return contender;
        },
        assertProjectAbsent: async () => {},
        startProject: async () => {
          events.push({ contender, operation: "up" });
        },
        initializeProject: async () => {
          throw new Error("forced startup failure");
        },
        cleanupProject: async () => {
          events.push({ contender, operation: "down" });
        },
        releaseOwnership: async (token) => {
          if (owner !== token) throw new Error("ownership changed");
          events.push({ contender, operation: "release" });
          owner = undefined;
        },
      });

    const results = await Promise.allSettled([start("first"), start("second")]);
    const claimOwner = events.find(({ operation }) => operation === "claim")?.contender;

    expect(results.every(({ status }) => status === "rejected")).toBe(true);
    expect(events.filter(({ operation }) => operation === "claim")).toHaveLength(1);
    expect(events.filter(({ operation }) => operation === "up")).toHaveLength(1);
    expect(events.filter(({ operation }) => operation === "down")).toHaveLength(1);
    expect(events.filter(({ operation }) => operation === "release")).toEqual([
      { contender: claimOwner, operation: "release" },
    ]);
    expect(owner).toBeUndefined();
  });
});
