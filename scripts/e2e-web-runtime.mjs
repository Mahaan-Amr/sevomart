import { cpSync } from "node:fs";
import { join } from "node:path";

export function prepareStandaloneWebRuntime(workspaceRoot) {
  const webRoot = join(workspaceRoot, "apps/web");
  const standaloneWebRoot = join(webRoot, ".next/standalone/apps/web");

  cpSync(join(webRoot, "public"), join(standaloneWebRoot, "public"), {
    recursive: true,
  });
  cpSync(join(webRoot, ".next/static"), join(standaloneWebRoot, ".next/static"), {
    recursive: true,
  });
}

export function standaloneWebCommand(workspaceRoot, port) {
  return {
    command: process.execPath,
    args: [join(workspaceRoot, "apps/web/.next/standalone/apps/web/server.js")],
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: port,
    },
  };
}
