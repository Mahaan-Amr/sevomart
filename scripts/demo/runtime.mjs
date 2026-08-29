import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../../ops/demo/manifest.v1.json", import.meta.url), "utf8"),
);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const supportedTargets = new Set(["local", "staging"]);

function parseOptions(argumentsList) {
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (
      argument === "--" ||
      argument === "--dry-run" ||
      argument === "--skip-migrate"
    ) {
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new Error(`Unexpected demo:seed argument: ${argument}`);
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    options.set(argument, value);
    index += 1;
  }
  return options;
}

export function createDemoSeedRequest(argumentsList, environment = process.env) {
  if (environment.SEVO_RUNTIME_ENV === "production") {
    throw new Error("demo:seed is disabled in production");
  }
  if (environment.DATABASE_URL) {
    throw new Error(
      "demo:seed rejects inherited DATABASE_URL; pass --database-url explicitly",
    );
  }
  if (
    (environment.OTP_PROVIDER ?? "dev") !== "dev" ||
    (environment.PAYMENT_PROVIDER ?? "dev") !== "dev" ||
    (environment.MEDIA_PROVIDER ?? "minio") !== "minio"
  ) {
    throw new Error("demo:seed requires internal development providers");
  }

  const options = parseOptions(argumentsList);
  const profile = options.get("--profile");
  const target = options.get("--target");
  const databaseUrl = options.get("--database-url");
  const fingerprint = options.get("--fingerprint");

  if (profile !== "demo") throw new Error("--profile demo is required");
  if (!target || !supportedTargets.has(target)) {
    throw new Error("--target must be local or staging");
  }
  if (!databaseUrl || !databaseUrl.startsWith("postgresql://")) {
    throw new Error("an explicit PostgreSQL --database-url is required");
  }
  if (!fingerprint || !uuidPattern.test(fingerprint)) {
    throw new Error("an explicit UUID --fingerprint is required");
  }

  return Object.freeze({
    databaseUrl,
    dryRun: argumentsList.includes("--dry-run"),
    fingerprint,
    namespace: manifest.namespace,
    profile,
    skipMigrate: argumentsList.includes("--skip-migrate"),
    target,
  });
}

function assertKnownTarget(request, target) {
  if (target.profile !== request.target) {
    throw new Error(
      `Database target profile is ${target.profile}; expected ${request.target}`,
    );
  }
  if (target.fingerprint !== request.fingerprint) {
    throw new Error("Database target fingerprint does not match --fingerprint");
  }
  const knownDatabase =
    (request.target === "local" && target.databaseName === "sevo") ||
    (request.target === "staging" && target.databaseName.startsWith("sevo_demo"));
  if (!knownDatabase) {
    throw new Error(`Unknown ${request.target} database destination`);
  }
}

export async function executeDemoSeed(request, database) {
  const target = await database.inspectTarget();
  assertKnownTarget(request, target);

  return database.withNamespaceLock(request.namespace, async () => {
    const report = {
      manifestVersion: manifest.manifestVersion,
      namespace: request.namespace,
      target: request.target,
      dryRun: request.dryRun,
      counts: { created: 0, updated: 0, retired: 0, unchanged: 0 },
    };
    if (!request.dryRun) await database.writeManifestReceipt(report);
    return report;
  });
}
