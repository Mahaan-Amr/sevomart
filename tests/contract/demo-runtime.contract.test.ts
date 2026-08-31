import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("versioned demo runtime contract", () => {
  it("registers the platform owner for every managed-data runtime table", () => {
    const ownership = JSON.parse(
      readFileSync("docs/architecture/module-ownership.json", "utf8"),
    ) as { tables: Record<string, string> };

    expect(ownership.tables).toMatchObject({
      platform_data_environment: "platform",
      platform_seed_manifest_receipts: "platform",
    });
  });

  it("publishes an explicit, versioned and namespaced manifest", () => {
    const manifest = JSON.parse(
      readFileSync("ops/demo/manifest.v1.json", "utf8"),
    ) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      manifestVersion: 2,
      namespace: "sevo.demo",
    });
    const resources = manifest.resources as Array<{
      kind: string;
      key: string;
      mediaKind?: string;
    }>;
    expect(resources).toHaveLength(48);
    expect(new Set(resources.map(({ key }) => key)).size).toBe(48);
    expect(resources.filter(({ kind }) => kind === "loginIdentity")).toHaveLength(5);
    expect(resources.filter(({ kind }) => kind === "store")).toHaveLength(4);
    expect(resources.filter(({ kind }) => kind === "product")).toHaveLength(11);
    expect(resources.filter(({ kind }) => kind === "salesContent")).toHaveLength(6);
    expect(resources.filter(({ kind }) => kind === "conversation")).toHaveLength(3);
    expect(resources.filter(({ kind }) => kind === "order")).toHaveLength(10);
    expect(
      (manifest.signIn as Array<{ startPath: string }>).map(
        ({ startPath }) => startPath,
      ),
    ).toEqual([
      "/",
      "/seller",
      "/seller/application",
      "/platform/seller-applications",
      "/platform/access",
    ]);
    expect(
      resources.filter(({ kind }) => kind === "salesContent").map((item) => item),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mediaKind: "IMAGE" }),
        expect.objectContaining({ mediaKind: "VIDEO" }),
      ]),
    );
  });

  it("uses the same guarded command after migration in native and Compose paths", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["demo:seed"]).toBe("node scripts/demo/seed.mjs");
    expect(packageJson.scripts["demo:target"]).toBe("node scripts/demo/target.mjs");
    expect(packageJson.scripts["qa:up"]).toBe("node scripts/qa/lifecycle.mjs up");
    expect(packageJson.scripts["qa:down"]).toBe("node scripts/qa/lifecycle.mjs down");

    const result = spawnSync(
      "docker",
      ["compose", "--profile", "demo", "config", "--format", "json"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          SEVO_DEMO_FINGERPRINT: "00000000-0000-4000-8000-000000000000",
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const services = (
      JSON.parse(result.stdout) as {
        services: Record<
          string,
          {
            command?: string[];
            depends_on?: Record<string, unknown>;
            environment?: object;
          }
        >;
      }
    ).services;
    const seed = services["demo-seed"];

    expect(seed?.depends_on).toHaveProperty("migrate");
    expect(seed?.depends_on).toHaveProperty("minio");
    expect(seed?.environment).not.toHaveProperty("DATABASE_URL");
    expect(seed?.command).toContain("scripts/demo/seed.mjs");
    expect(seed?.command).not.toContain("--skip-migrate");
  });

  it("runs the stateful baseline after shared integration tests", () => {
    const sharedConfig = readFileSync("vitest.integration.config.ts", "utf8");
    const demoConfig = readFileSync("vitest.demo-seed.integration.config.ts", "utf8");
    const runner = readFileSync("scripts/run-integration-tests.mjs", "utf8");

    expect(sharedConfig).toContain("tests/integration/demo-seed-runtime.test.ts");
    expect(demoConfig).toContain(
      'include: ["tests/integration/demo-seed-runtime.test.ts"]',
    );
    expect(runner.indexOf("vitest.integration.config.ts")).toBeLessThan(
      runner.indexOf("vitest.demo-seed.integration.config.ts"),
    );
  });
});
