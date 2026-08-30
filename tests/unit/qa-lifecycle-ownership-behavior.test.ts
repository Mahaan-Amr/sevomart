import { describe, expect, it } from "vitest";

import { runOwnedQaStartup } from "../../scripts/qa/startup-ownership.mjs";

describe("QA lifecycle ownership behavior", () => {
  it("retains the ownership claim when destructive cleanup is unconfirmed", async () => {
    let owner: string | undefined = "owner-token";

    await expect(
      runOwnedQaStartup({
        acquireOwnership: async () => "owner-token",
        assertProjectAbsent: async () => {},
        startProject: async () => {},
        initializeProject: async () => {
          throw new Error("startup failed");
        },
        cleanupProject: async () => {
          throw new Error("cleanup failed");
        },
        releaseOwnership: async () => {
          owner = undefined;
        },
      }),
    ).rejects.toThrow("startup failed");

    expect(owner).toBe("owner-token");
  });
});
