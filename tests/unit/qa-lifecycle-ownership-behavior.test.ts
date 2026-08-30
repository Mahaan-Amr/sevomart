import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("QA lifecycle ownership behavior", () => {
  it("allows only one racing startup to perform destructive cleanup", async () => {
    const fixture = createFakeRuntime();
    const [first, second] = await Promise.all([
      runLifecycle(fixture, "first"),
      runLifecycle(fixture, "second"),
    ]);

    expect(first.status).not.toBe(0);
    expect(second.status).not.toBe(0);
    const destructiveCleanups = readEvents(fixture.stateDirectory).filter(
      (event) => event.operation === "down",
    );
    expect(destructiveCleanups).toHaveLength(1);
  });
});

type Fixture = {
  executableDirectory: string;
  stateDirectory: string;
};

function createFakeRuntime(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "sevo-qa-ownership-"));
  temporaryDirectories.push(root);
  const executableDirectory = join(root, "bin");
  const stateDirectory = join(root, "state");
  mkdirSync(executableDirectory);
  mkdirSync(stateDirectory);

  writeExecutable(
    join(executableDirectory, "docker"),
    `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const state = process.env.FAKE_DOCKER_STATE;
const contender = process.env.SEVO_QA_TEST_CONTENDER;
const ownerPath = join(state, "owner.json");
const eventsPath = join(state, "events.ndjson");
const record = (operation) => appendFileSync(eventsPath, JSON.stringify({ contender, operation }) + "\\n");
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);

if (args[0] === "volume" && args[1] === "create") {
  const label = args.find((argument) => argument.startsWith("sevo.qa.owner-token="));
  const token = label?.slice("sevo.qa.owner-token=".length) ?? "";
  try {
    writeFileSync(ownerPath, JSON.stringify({ contender, token }), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  process.stdout.write(args.at(-1) + "\\n");
  process.exit(0);
}

if (args[0] === "volume" && args[1] === "inspect") {
  if (!existsSync(ownerPath)) process.exit(1);
  process.stdout.write(JSON.parse(readFileSync(ownerPath, "utf8")).token + "\\n");
  process.exit(0);
}

if (args[0] === "volume" && args[1] === "rm") {
  if (existsSync(ownerPath)) unlinkSync(ownerPath);
  process.exit(0);
}

if (["container", "network", "volume"].includes(args[0]) && args[1] === "ls") {
  if (args[0] === "volume" && !existsSync(ownerPath)) {
    writeFileSync(join(state, "listed-" + contender), "ready");
    const deadline = Date.now() + 5_000;
    while (
      !(existsSync(join(state, "listed-first")) && existsSync(join(state, "listed-second")))
    ) {
      if (Date.now() > deadline) process.exit(2);
      pause();
    }
  }
  process.exit(0);
}

const composeOperation = ["up", "down", "port"].find((operation) => args.includes(operation));
if (composeOperation === "up" || composeOperation === "down") {
  record(composeOperation);
  process.exit(0);
}
if (composeOperation === "port") {
  process.stdout.write("127.0.0.1:55000\\n");
  process.exit(0);
}
process.exit(3);
`,
  );
  writeExecutable(
    join(executableDirectory, "pnpm"),
    `#!/usr/bin/env node
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
process.exit(1);
`,
  );
  return { executableDirectory, stateDirectory };
}

function writeExecutable(path: string, source: string) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

async function runLifecycle(fixture: Fixture, contender: string) {
  return await new Promise<{ status: number | null }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/qa/lifecycle.mjs", "up", "--profile", "qa", "--run-id", "race-126"],
      {
        env: {
          PATH: `${fixture.executableDirectory}:${process.env.PATH}`,
          FAKE_DOCKER_STATE: fixture.stateDirectory,
          OTP_PROVIDER: "dev",
          SEVO_QA_TEST_CONTENDER: contender,
          SEVO_RUNTIME_ENV: "test",
        },
        stdio: "ignore",
      },
    );
    child.once("error", reject);
    child.once("exit", (status) => resolve({ status }));
  });
}

function readEvents(stateDirectory: string) {
  const events = readFileSync(join(stateDirectory, "events.ndjson"), "utf8");
  return events
    .trim()
    .split("\n")
    .map((event) => JSON.parse(event) as { contender: string; operation: string });
}
