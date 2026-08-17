import { describe, expect, it } from "vitest";

import { dependencyIsReady } from "./readiness";

describe("worker dependency readiness", () => {
  it("is ready only when the configured dependency responds successfully", async () => {
    await expect(dependencyIsReady(undefined)).resolves.toBe(false);
    await expect(
      dependencyIsReady("http://api/health/ready", async () => ({ ok: true })),
    ).resolves.toBe(true);
    await expect(
      dependencyIsReady("http://api/health/ready", async () => ({ ok: false })),
    ).resolves.toBe(false);
  });

  it("reports unavailable when the dependency request fails", async () => {
    await expect(
      dependencyIsReady("http://api/health/ready", async () => {
        throw new Error("offline");
      }),
    ).resolves.toBe(false);
  });
});
