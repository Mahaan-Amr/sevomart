import { describe, expect, it, vi } from "vitest";

import { createDemoSeedRequest, executeDemoSeed } from "../../scripts/demo/runtime.mjs";

const fingerprint = "8e2cd400-e2d7-4ff8-b390-cb265d3eaf9b";
const safeArguments = [
  "--profile",
  "demo",
  "--target",
  "local",
  "--database-url",
  "postgresql://sevo:sevo_local@localhost:6432/sevo",
  "--fingerprint",
  fingerprint,
];

describe("demo seed runtime", () => {
  it.each([
    {
      name: "production",
      argumentsList: safeArguments,
      environment: {
        SEVO_RUNTIME_ENV: "production",
        MINIO_ENDPOINT: "127.0.0.1",
      },
      message: "production",
    },
    {
      name: "an implicit runtime environment",
      argumentsList: safeArguments,
      environment: { MINIO_ENDPOINT: "127.0.0.1" },
      message: "SEVO_RUNTIME_ENV",
    },
    {
      name: "an inherited database URL",
      argumentsList: safeArguments,
      environment: {
        SEVO_RUNTIME_ENV: "development",
        DATABASE_URL: "postgresql://human-data.example/sevo",
        MINIO_ENDPOINT: "127.0.0.1",
      },
      message: "DATABASE_URL",
    },
    {
      name: "an unknown destination",
      argumentsList: safeArguments.map((argument) =>
        argument === "local" ? "preview" : argument,
      ),
      environment: {
        SEVO_RUNTIME_ENV: "development",
        MINIO_ENDPOINT: "127.0.0.1",
      },
      message: "target",
    },
    {
      name: "an external OTP provider",
      argumentsList: safeArguments,
      environment: {
        SEVO_RUNTIME_ENV: "development",
        MINIO_ENDPOINT: "127.0.0.1",
        OTP_PROVIDER: "external",
      },
      message: "provider",
    },
    {
      name: "an external media provider endpoint",
      argumentsList: safeArguments,
      environment: {
        SEVO_RUNTIME_ENV: "development",
        MINIO_ENDPOINT: "objects.example.com",
        OTP_PROVIDER: "dev",
      },
      message: "provider",
    },
    {
      name: "a remote local destination",
      argumentsList: safeArguments.map((argument) =>
        argument.includes("localhost:6432")
          ? "postgresql://sevo:sevo_local@database.example.com:6432/sevo"
          : argument,
      ),
      environment: {
        SEVO_RUNTIME_ENV: "development",
        MINIO_ENDPOINT: "127.0.0.1",
      },
      message: "destination",
    },
  ])("rejects $name before inspecting the database", async (scenario) => {
    const inspectTarget = vi.fn();

    expect(() =>
      createDemoSeedRequest(scenario.argumentsList, scenario.environment),
    ).toThrow(scenario.message);
    expect(inspectTarget).not.toHaveBeenCalled();
  });

  it("reports a dry run without writing and under the single-run lock", async () => {
    const request = createDemoSeedRequest([...safeArguments, "--dry-run"], {
      SEVO_RUNTIME_ENV: "development",
      MINIO_ENDPOINT: "127.0.0.1",
      OTP_PROVIDER: "dev",
    });
    const writeManifestReceipt = vi.fn();
    const withNamespaceLock = vi.fn(async (_namespace, operation) => operation());

    const report = await executeDemoSeed(request, {
      inspectTarget: async () => ({
        databaseName: "sevo",
        fingerprint,
        profile: "local",
      }),
      withNamespaceLock,
      writeManifestReceipt,
    });

    expect(report).toEqual({
      manifestVersion: 1,
      namespace: "sevo.demo",
      target: "local",
      dryRun: true,
      counts: { created: 0, updated: 0, retired: 0, unchanged: 0 },
    });
    expect(withNamespaceLock).toHaveBeenCalledWith("sevo.demo", expect.any(Function));
    expect(writeManifestReceipt).not.toHaveBeenCalled();
  });

  it("rejects a mismatched registered fingerprint before locking or writing", async () => {
    const request = createDemoSeedRequest(safeArguments, {
      SEVO_RUNTIME_ENV: "development",
      MINIO_ENDPOINT: "127.0.0.1",
      OTP_PROVIDER: "dev",
    });
    const withNamespaceLock = vi.fn();
    const writeManifestReceipt = vi.fn();

    await expect(
      executeDemoSeed(request, {
        inspectTarget: async () => ({
          databaseName: "sevo",
          fingerprint: "b4982f3e-9e2a-43a3-80a4-31fe4a0c2a0a",
          profile: "local",
        }),
        withNamespaceLock,
        writeManifestReceipt,
      }),
    ).rejects.toThrow("fingerprint");
    expect(withNamespaceLock).not.toHaveBeenCalled();
    expect(writeManifestReceipt).not.toHaveBeenCalled();
  });
});
