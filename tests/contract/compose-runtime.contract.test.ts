import { spawnSync } from "node:child_process";

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
});
