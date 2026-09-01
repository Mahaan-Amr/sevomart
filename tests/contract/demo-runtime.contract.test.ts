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

    expect(manifest).toEqual({
      schemaVersion: 1,
      manifestVersion: 1,
      namespace: "sevo.demo",
      resources: [],
    });
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
    expect(seed?.environment).not.toHaveProperty("DATABASE_URL");
    expect(seed?.command).toContain("scripts/demo/seed.mjs");
    expect(seed?.command).not.toContain("--skip-migrate");
  });
});
