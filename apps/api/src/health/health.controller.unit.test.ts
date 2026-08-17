import { describe, expect, it } from "vitest";

import { HealthController } from "./health.controller";

describe("HealthController readiness", () => {
  it("reports ready only when PostgreSQL and object storage are ready", async () => {
    const ready = new HealthController(async () => true);
    await expect(ready.ready()).resolves.toEqual({
      status: "ok",
      service: "api",
      version: 1,
    });

    const unavailable = new HealthController(async () => false);
    await expect(unavailable.ready()).rejects.toMatchObject({
      status: 503,
    });
  });
});
