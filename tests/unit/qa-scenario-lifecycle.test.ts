import { describe, expect, it, vi } from "vitest";

import { createQaScenarioLifecycle } from "../../scripts/qa/scenario-lifecycle.mjs";

const fingerprint = "8e2cd400-e2d7-4ff8-b390-cb265d3eaf9b";

describe("QA scenario lifecycle adapter", () => {
  it("uses only the disposable QA runtime and removes the owned target", async () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce({
        error: undefined,
        status: 0,
        stderr: "",
        output: [
          null,
          "malformed stdout that is not the target report\n",
          "",
          `${JSON.stringify({
            databaseName: "sevo_qa_checkout_failure_a1b2c3d4e5f6",
            databasePort: 55432,
            fingerprint,
            minioPort: 59000,
            profile: "qa",
            projectName: "sevomart-qa-checkout-failure-a1b2c3d4e5f6",
            runId: "checkout-failure-a1b2c3d4e5f6",
          })}\n`,
        ],
        stdout: "malformed stdout that is not the target report\n",
      })
      .mockReturnValueOnce({
        error: undefined,
        output: [null, '{"removed":true}\n', '{"event":"qa-project-cleanup"}\n'],
        status: 0,
        stderr: '{"event":"qa-project-cleanup"}\n',
        stdout: '{"removed":true}\n',
      });
    const lifecycle = createQaScenarioLifecycle({
      environment: {
        DATABASE_URL: "postgresql://human-data.example/sevo",
        OTP_PROVIDER: "external",
        SEVO_RUNTIME_ENV: "production",
      },
      spawn,
    });

    await expect(lifecycle.up("checkout-failure-a1b2c3d4e5f6")).resolves.toMatchObject({
      fingerprint,
      profile: "qa",
    });
    await lifecycle.down({
      fingerprint,
      runId: "checkout-failure-a1b2c3d4e5f6",
    });

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0]?.[1]).toEqual([
      expect.stringMatching(/scripts[/\\]qa[/\\]lifecycle\.mjs$/),
      "up",
      "--profile",
      "qa",
      "--run-id",
      "checkout-failure-a1b2c3d4e5f6",
    ]);
    expect(spawn.mock.calls[0]?.[2]?.stdio).toEqual(["ignore", "pipe", "pipe", "pipe"]);
    expect(spawn.mock.calls[1]?.[1]).toEqual([
      expect.stringMatching(/scripts[/\\]qa[/\\]lifecycle\.mjs$/),
      "down",
      "--profile",
      "qa",
      "--run-id",
      "checkout-failure-a1b2c3d4e5f6",
      "--fingerprint",
      fingerprint,
    ]);
    for (const call of spawn.mock.calls) {
      expect(call[2]?.env).toMatchObject({
        OTP_PROVIDER: "dev",
        SEVO_RUNTIME_ENV: "test",
      });
      expect(call[2]?.env).not.toHaveProperty("DATABASE_URL");
      expect(call[2]?.shell).toBe(false);
    }
  });
});
