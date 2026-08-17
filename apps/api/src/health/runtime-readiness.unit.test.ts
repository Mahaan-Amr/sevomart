import { describe, expect, it, vi } from "vitest";

import { createReadinessCheck } from "./runtime-readiness";

describe("API dependency readiness", () => {
  it("requires both PostgreSQL and object storage", async () => {
    const postgresReady = vi.fn().mockResolvedValue(true);
    const objectStorageReady = vi.fn().mockResolvedValue(true);
    const check = createReadinessCheck([postgresReady, objectStorageReady]);

    await expect(check()).resolves.toBe(true);
    objectStorageReady.mockResolvedValue(false);
    await expect(check()).resolves.toBe(false);
    postgresReady.mockResolvedValue(false);
    objectStorageReady.mockResolvedValue(true);
    await expect(check()).resolves.toBe(false);
  });

  it("reports unavailable when either dependency probe fails", async () => {
    const check = createReadinessCheck([
      async () => {
        throw new Error("database unavailable");
      },
      async () => true,
    ]);

    await expect(check()).resolves.toBe(false);
  });
});
