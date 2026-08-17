import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("web readiness route", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns success only when API readiness succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await expect(GET()).resolves.toMatchObject({ status: 200 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(GET()).resolves.toMatchObject({ status: 503 });
  });

  it("returns unavailable when API readiness cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(GET()).resolves.toMatchObject({ status: 503 });
  });
});
