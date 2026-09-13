import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  prepareStandaloneWebRuntime,
  standaloneWebCommand,
} from "../../scripts/e2e-web-runtime.mjs";

describe("E2E standalone web runtime", () => {
  it("copies public assets into the standalone tree and starts its server", () => {
    const workspace = mkdtempSync(join(tmpdir(), "sevo-e2e-web-"));
    mkdirSync(join(workspace, "apps/web/public"), { recursive: true });
    mkdirSync(join(workspace, "apps/web/.next/static/chunks"), { recursive: true });
    mkdirSync(join(workspace, "apps/web/.next/standalone/apps/web"), {
      recursive: true,
    });
    writeFileSync(join(workspace, "apps/web/public/icon.svg"), "public");
    writeFileSync(join(workspace, "apps/web/.next/static/chunks/app.js"), "static");
    writeFileSync(
      join(workspace, "apps/web/.next/standalone/apps/web/server.js"),
      "server",
    );

    prepareStandaloneWebRuntime(workspace);

    expect(
      readFileSync(
        join(workspace, "apps/web/.next/standalone/apps/web/public/icon.svg"),
        "utf8",
      ),
    ).toBe("public");
    expect(
      readFileSync(
        join(
          workspace,
          "apps/web/.next/standalone/apps/web/.next/static/chunks/app.js",
        ),
        "utf8",
      ),
    ).toBe("static");
    expect(standaloneWebCommand(workspace, "4110")).toEqual({
      command: process.execPath,
      args: [join(workspace, "apps/web/.next/standalone/apps/web/server.js")],
      env: expect.objectContaining({ HOSTNAME: "127.0.0.1", PORT: "4110" }),
    });
  });
});
