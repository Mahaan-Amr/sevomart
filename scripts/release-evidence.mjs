import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

import {
  createReleaseEvidencePlan,
  finalizeReleaseEvidence,
  validateReleaseEvidenceManifest,
} from "./qa/release-evidence.v1.mjs";

const manifestPath = resolve("ops/qa/release-evidence-manifest.v1.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const [command, ...rawArguments] = process.argv.slice(2);

try {
  if (command === "validate") {
    validateManifestAndTraces(manifest);
    process.stdout.write(
      `${JSON.stringify({ contractVersion: 1, journeys: manifest.journeys.length, valid: true })}\n`,
    );
  } else if (command === "plan") {
    validateManifestAndTraces(manifest);
    const options = parseOptions(rawArguments);
    const sha = required(options, "--sha");
    const migration = required(options, "--migration");
    const seedVersion = Number(required(options, "--seed-version"));
    validateRepositoryBindings({ sha, migration, seedVersion });
    const bindings = { sha, migration, seedVersion };
    const plan = createReleaseEvidencePlan(manifest, {
      sha,
      migration,
      seedVersion,
      health: {
        api: artifact(required(options, "--health-api"), bindings),
        web: artifact(required(options, "--health-web"), bindings),
        worker: artifact(required(options, "--health-worker"), bindings),
      },
      startup: {
        docker: artifact(required(options, "--startup-docker"), bindings),
        native: artifact(required(options, "--startup-native"), bindings),
      },
      author: required(options, "--author"),
    });
    writeJson(required(options, "--output"), plan);
  } else if (command === "finalize") {
    validateManifestAndTraces(manifest);
    const options = parseOptions(rawArguments);
    const input = JSON.parse(readFileSync(required(options, "--input"), "utf8"));
    validateRepositoryBindings(input.candidate);
    writeJson(required(options, "--output"), finalizeReleaseEvidence(manifest, input));
  } else {
    throw new Error("Usage: release-evidence <validate|plan|finalize> [options]");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function artifact(path, bindings) {
  const ref = resolve(path);
  const bytes = readFileSync(ref);
  return {
    ref,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...bindings,
  };
}

function validateRepositoryBindings({ sha, migration, seedVersion }) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (sha !== head)
    throw new Error(`Candidate SHA ${sha} does not match checked-out HEAD ${head}`);

  const migrations = readdirSync(resolve("packages/database/prisma/migrations"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const latestMigration = migrations.at(-1);
  if (migration !== latestMigration) {
    throw new Error(
      `Candidate migration ${migration} does not match ${latestMigration}`,
    );
  }

  const demoManifest = JSON.parse(
    readFileSync(resolve("ops/demo/manifest.v1.json"), "utf8"),
  );
  if (seedVersion !== demoManifest.manifestVersion) {
    throw new Error(
      `Candidate seed version ${seedVersion} does not match ${demoManifest.manifestVersion}`,
    );
  }
}

function validateManifestAndTraces(candidateManifest) {
  validateReleaseEvidenceManifest(candidateManifest);
  for (const journey of candidateManifest.journeys) {
    for (const traces of Object.values(journey.tests)) {
      for (const trace of traces) readFileSync(resolve(trace));
    }
  }
}

function parseOptions(argumentsList) {
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid option near ${name ?? "end of command"}`);
    }
    if (options.has(name)) throw new Error(`Duplicate option ${name}`);
    options.set(name, value);
  }
  return options;
}

function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function writeJson(path, value) {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${absolutePath}\n`);
}
