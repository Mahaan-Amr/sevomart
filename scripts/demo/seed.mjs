import { spawnSync } from "node:child_process";

import { createPostgresDemoSeedDatabase } from "./postgres.mjs";
import { createDemoSeedRequest, executeDemoSeed } from "./runtime.mjs";

let database;
try {
  const argumentsList = process.argv.slice(2).filter((argument) => argument !== "--");
  const request = createDemoSeedRequest(argumentsList);

  if (!request.skipMigrate) {
    const pnpmEntryPoint = process.env.npm_execpath;
    const command = pnpmEntryPoint ? process.execPath : "pnpm";
    const commandArguments = pnpmEntryPoint
      ? [
          pnpmEntryPoint,
          "--filter",
          "@sevo/database",
          "exec",
          "prisma",
          "migrate",
          "deploy",
        ]
      : ["--filter", "@sevo/database", "exec", "prisma", "migrate", "deploy"];
    const migration = spawnSync(command, commandArguments, {
      env: { ...process.env, DATABASE_URL: request.databaseUrl },
      stdio: "inherit",
    });
    if (migration.error) throw migration.error;
    if (migration.status !== 0) {
      throw new Error("Database migration failed before demo:seed");
    }
  }

  database = createPostgresDemoSeedDatabase(request.databaseUrl);
  const report = await executeDemoSeed(request, database);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "demo:seed failed");
  process.exitCode = 1;
} finally {
  await database?.close();
}
