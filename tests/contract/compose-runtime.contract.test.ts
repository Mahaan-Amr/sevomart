import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type ComposePort = { host_ip: string; published: string; target: number };
type ComposeService = { ports?: ComposePort[] };

describe("complete Compose runtime contract", () => {
  it("applies every documented host-port override on loopback", () => {
    const result = spawnSync("docker", ["compose", "config", "--format", "json"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        WEB_HOST_PORT: "43100",
        API_HOST_PORT: "43101",
        POSTGRES_HOST_PORT: "46432",
        MINIO_HOST_PORT: "49100",
        MINIO_CONSOLE_HOST_PORT: "49101",
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const services = (
      JSON.parse(result.stdout) as {
        services: Record<string, ComposeService>;
      }
    ).services;

    expect(services.web?.ports).toContainEqual({
      host_ip: "127.0.0.1",
      published: "43100",
      target: 3000,
      mode: "ingress",
      protocol: "tcp",
    });
    expect(services.api?.ports?.[0]).toMatchObject({
      host_ip: "127.0.0.1",
      published: "43101",
    });
    expect(services.postgres?.ports?.[0]).toMatchObject({
      host_ip: "127.0.0.1",
      published: "46432",
    });
    expect(services.minio?.ports?.map((port) => port.published)).toEqual([
      "49100",
      "49101",
    ]);
  });

  it("runs local browser acceptance against an isolated disposable stack", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const runner = readFileSync("scripts/run-e2e-tests.mjs", "utf8");
    const playwrightConfig = readFileSync("playwright.config.ts", "utf8");

    expect(packageJson.scripts["test:e2e"]).toBe("node scripts/run-e2e-tests.mjs");
    expect(runner).toContain('const composeProject = "sevomart-e2e"');
    expect(runner).toContain(
      'DATABASE_URL: "postgresql://sevo:sevo_local@localhost:8432/sevo"',
    );
    expect(runner).toContain('MINIO_HOST_PORT: "10200"');
    expect(runner).toContain('SEVO_E2E_ISOLATED: "1"');
    expect(runner).toContain("resetComposeStack");
    expect(runner).toContain('["down", "--volumes", "--remove-orphans"]');
    expect(runner).toContain("const playwrightArguments = process.argv");
    expect(runner).toContain('.filter((argument) => argument !== "--")');
    expect(runner).toContain('["exec", "playwright", "test", ...playwrightArguments]');
    expect(playwrightConfig).toContain(
      'process.env.SEVO_E2E_ISOLATED !== "1" && !process.env.CI',
    );
    expect(playwrightConfig).toContain('command: "pnpm e2e:worker"');
    expect(playwrightConfig).toContain('url: "http://127.0.0.1:3108/health/ready"');
  });

  it("isolates OTP request limits between integration scenarios", () => {
    const integrationConfig = readFileSync("vitest.integration.config.ts", "utf8");
    const integrationSetup = readFileSync(
      "tests/helpers/integration-test-setup.ts",
      "utf8",
    );

    expect(integrationConfig).toContain(
      'setupFiles: ["tests/helpers/integration-test-setup.ts"]',
    );
    expect(integrationSetup).toContain("beforeEach");
    expect(integrationSetup).toContain("delete from identity_otp_challenges");
  });

  it("keeps the release tracers on real HTTP seams", () => {
    const tracer = readFileSync("tests/e2e/release-critical-tracers.spec.ts", "utf8");

    expect(tracer).toContain("/v1/seller-applications");
    expect(tracer).toContain("/approval");
    expect(tracer).toContain("/publications");
    expect(tracer).toContain("/v1/feeds/discovery");
    expect(tracer).toContain("/v1/me/feeds/following");
    expect(tracer).toContain("testInfo.retry");
    expect(tracer).toContain("retry * 4");
    expect(tracer).toContain("/v1/checkout/prepare");
    expect(tracer).toContain("/payment-attempts");
    expect(tracer).toContain("/v1/seller/orders");
    expect(tracer).not.toContain("page.route(");
    expect(tracer).not.toContain("insert into order_");
  });
});
