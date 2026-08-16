import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const importPattern =
  /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

export function findBoundaryViolations(files) {
  const violations = [];

  for (const file of files) {
    const sourcePath = toPosix(file.path);
    const sourceModule = sourcePath.match(/apps\/api\/src\/modules\/([^/]+)\//)?.[1];

    for (const match of file.source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;

      const resolved = toPosix(
        path.posix.normalize(
          path.posix.join(path.posix.dirname(sourcePath), specifier),
        ),
      );
      const targetModuleMatch = resolved.match(
        /apps\/api\/src\/modules\/([^/]+)\/(.+)$/,
      );

      const sourceLayer = sourcePath.match(
        /apps\/api\/src\/modules\/[^/]+\/(application|domain|public(?:\.[cm]?tsx?)?)/,
      )?.[1];
      const targetLayer = targetModuleMatch?.[2].split("/")[0];

      if (
        sourceModule &&
        sourceLayer &&
        targetModuleMatch &&
        targetModuleMatch[1] === sourceModule &&
        (targetLayer === "infrastructure" || targetLayer === "testing")
      ) {
        violations.push({
          path: sourcePath,
          import: specifier,
          rule: "module-core-does-not-import-adapter",
        });
      }

      if (
        sourceModule &&
        targetModuleMatch &&
        targetModuleMatch[1] !== sourceModule &&
        !/^public(?:\.[cm]?tsx?)?$/.test(targetModuleMatch[2])
      ) {
        violations.push({
          path: sourcePath,
          import: specifier,
          rule: "module-public-contract-only",
        });
      }

      const isBuyerSource = sourcePath.includes("/(buyer)/");
      const isSellerSource = sourcePath.includes("/(seller)/");
      const crossesWebArea =
        (isBuyerSource && resolved.includes("/(seller)/")) ||
        (isSellerSource && resolved.includes("/(buyer)/"));

      if (crossesWebArea) {
        violations.push({
          path: sourcePath,
          import: specifier,
          rule: "web-area-independence",
        });
      }
    }
  }

  return violations;
}

export function findMigrationOwnershipViolations(paths, registeredModules) {
  const violations = [];
  const convention =
    /^packages\/database\/prisma\/migrations\/\d{14}__([a-z][a-z0-9-]*)__[a-z0-9]+(?:-[a-z0-9]+)*\/migration\.sql$/;

  for (const migrationPath of paths.map(toPosix)) {
    const match = migrationPath.match(convention);
    if (!match) {
      violations.push({
        path: migrationPath,
        rule: "migration-directory-convention",
      });
      continue;
    }

    const owner = match[1];
    if (!owner || !registeredModules.has(owner)) {
      violations.push({
        path: migrationPath,
        rule: "registered-migration-owner",
      });
    }
  }

  return violations;
}

export function findTableOwnershipViolations(schema, tableOwners, registeredModules) {
  const violations = [];
  const modelPattern = /model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g;

  for (const match of schema.matchAll(modelPattern)) {
    const modelName = match[1];
    const body = match[2] ?? "";
    const mappedName = body.match(/@@map\(\s*["']([^"']+)["']\s*\)/)?.[1];
    const tableName = mappedName ?? modelName;
    const owner = tableOwners[tableName];

    if (!owner) {
      violations.push({ table: tableName, rule: "registered-table-owner" });
    } else if (!registeredModules.has(owner)) {
      violations.push({
        table: tableName,
        owner,
        rule: "registered-table-owner-module",
      });
    }
  }

  return violations;
}

async function collectSources(root) {
  const files = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (sourceExtensions.has(path.extname(entry.name))) {
        files.push({
          path: toPosix(path.relative(root, absolutePath)),
          source: await readFile(absolutePath, "utf8"),
        });
      }
    }
  }

  await Promise.all([
    visit(path.join(root, "apps", "api", "src")),
    visit(path.join(root, "apps", "web", "src")),
  ]);
  return files;
}

async function collectMigrationPaths(root) {
  const migrationRoot = path.join(root, "packages", "database", "prisma", "migrations");
  const paths = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.name === "migration.sql") {
        paths.push(toPosix(path.relative(root, absolutePath)));
      }
    }
  }

  await visit(migrationRoot);
  return paths;
}

async function main() {
  const root = process.cwd();
  const ownership = JSON.parse(
    await readFile(
      path.join(root, "docs", "architecture", "module-ownership.json"),
      "utf8",
    ),
  );
  const registeredModules = new Set(ownership.modules);
  const databaseSchema = await readFile(
    path.join(root, "packages", "database", "prisma", "schema.prisma"),
    "utf8",
  );
  const violations = [
    ...findBoundaryViolations(await collectSources(root)),
    ...findMigrationOwnershipViolations(
      await collectMigrationPaths(root),
      registeredModules,
    ),
    ...findTableOwnershipViolations(
      databaseSchema,
      ownership.tables,
      registeredModules,
    ),
  ];

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `${violation.path ?? violation.table}: ${violation.rule}${violation.import ? ` (${violation.import})` : ""}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log("Architecture boundaries are valid.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
