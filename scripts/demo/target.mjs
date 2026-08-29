import { createPostgresDemoSeedDatabase } from "./postgres.mjs";

const argumentsList = process.argv.slice(2).filter((argument) => argument !== "--");
const databaseUrlIndex = argumentsList.indexOf("--database-url");
const databaseUrl = argumentsList[databaseUrlIndex + 1];

if (process.env.DATABASE_URL) {
  throw new Error(
    "demo:target rejects inherited DATABASE_URL; pass --database-url explicitly",
  );
}
if (!databaseUrl?.startsWith("postgresql://")) {
  throw new Error("an explicit PostgreSQL --database-url is required");
}

const database = createPostgresDemoSeedDatabase(databaseUrl);
try {
  process.stdout.write(`${JSON.stringify(await database.inspectTarget())}\n`);
} finally {
  await database.close();
}
