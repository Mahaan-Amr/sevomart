import { createPostgresDemoSeedDatabase } from "./postgres.mjs";
import { parseCommandOptions, requireExplicitDatabaseUrl } from "./runtime.mjs";

const argumentsList = process.argv.slice(2).filter((argument) => argument !== "--");
const options = parseCommandOptions(argumentsList);
const { databaseUrl } = requireExplicitDatabaseUrl(options, process.env, "demo:target");

const database = createPostgresDemoSeedDatabase(databaseUrl);
try {
  process.stdout.write(`${JSON.stringify(await database.inspectTarget())}\n`);
} finally {
  await database.close();
}
