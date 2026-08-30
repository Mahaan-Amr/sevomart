import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../../ops/demo/manifest.v1.json", import.meta.url), "utf8"),
);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localHosts = new Set(["127.0.0.1", "localhost", "::1", "postgres"]);
const localMinioHosts = new Set(["127.0.0.1", "localhost", "minio"]);
const targetPolicies = new Map([
  [
    "local",
    {
      acceptsDatabaseName: (name) => name === "sevo",
      acceptsDatabaseHost: (host) => localHosts.has(host),
      acceptsMinioHost: (host) => localMinioHosts.has(host),
    },
  ],
  [
    "staging",
    {
      acceptsDatabaseName: (name) => name.startsWith("sevo_demo"),
      acceptsDatabaseHost: (host, environment) =>
        Boolean(environment.SEVO_DEMO_STAGING_DATABASE_HOST) &&
        host === environment.SEVO_DEMO_STAGING_DATABASE_HOST,
      acceptsMinioHost: (host, environment) =>
        Boolean(environment.SEVO_DEMO_STAGING_MINIO_HOST) &&
        host === environment.SEVO_DEMO_STAGING_MINIO_HOST,
    },
  ],
]);

export function parseCommandOptions(argumentsList) {
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--" || argument === "--dry-run") {
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

export function requireExplicitDatabaseUrl(
  options,
  environment = process.env,
  commandName = "demo:seed",
) {
  if (environment.DATABASE_URL) {
    throw new Error(
      `${commandName} rejects inherited DATABASE_URL; pass --database-url explicitly`,
    );
  }
  const databaseUrl = options.get("--database-url");
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgresql:") throw new Error("invalid protocol");
    return { databaseUrl, parsed };
  } catch {
    throw new Error("an explicit PostgreSQL --database-url is required");
  }
}

export function createDemoSeedRequest(argumentsList, environment = process.env) {
  if (environment.SEVO_RUNTIME_ENV !== "development") {
    throw new Error(
      "demo:seed requires explicit SEVO_RUNTIME_ENV=development and is disabled in production",
    );
  }

  const options = parseCommandOptions(argumentsList);
  const profile = options.get("--profile");
  const target = options.get("--target");
  const fingerprint = options.get("--fingerprint");

  if (profile !== "demo") throw new Error("--profile demo is required");
  const targetPolicy = targetPolicies.get(target);
  if (!target || !targetPolicy) {
    throw new Error("--target must be local or staging");
  }
  const { databaseUrl, parsed: parsedDatabaseUrl } = requireExplicitDatabaseUrl(
    options,
    environment,
  );
  if (!targetPolicy.acceptsDatabaseHost(parsedDatabaseUrl.hostname, environment)) {
    throw new Error(`Unknown ${target} database destination host`);
  }
  if (
    environment.OTP_PROVIDER !== "dev" ||
    !environment.MINIO_ENDPOINT ||
    !targetPolicy.acceptsMinioHost(environment.MINIO_ENDPOINT, environment)
  ) {
    throw new Error("demo:seed requires explicit internal development providers");
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
  const targetPolicy = targetPolicies.get(request.target);
  if (!targetPolicy?.acceptsDatabaseName(target.databaseName)) {
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
