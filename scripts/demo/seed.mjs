import { createPostgresDemoSeedDatabase } from "./postgres.mjs";
import { createDemoSeedRequest, executeDemoSeed } from "./runtime.mjs";

let database;
try {
  const argumentsList = process.argv.slice(2).filter((argument) => argument !== "--");
  const request = createDemoSeedRequest(argumentsList);

  database = createPostgresDemoSeedDatabase(request.databaseUrl);
  const report = await executeDemoSeed(request, database);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "demo:seed failed");
  process.exitCode = 1;
} finally {
  await database?.close();
}
