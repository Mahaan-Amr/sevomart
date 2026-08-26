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
    const sourceModuleMatch = sourcePath.match(
      /apps\/(api|worker)\/src\/modules\/([^/]+)\//,
    );
    const sourceRuntime = sourceModuleMatch?.[1];
    const sourceModule = sourceModuleMatch?.[2];

    if (
      sourceModule &&
      /\bplatform_outbox_(?:events|consumptions)\b/.test(file.source)
    ) {
      violations.push({
        path: sourcePath,
        rule: "module-does-not-access-platform-outbox-data",
      });
    }

    for (const match of file.source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      if (!specifier.startsWith(".")) continue;

      const resolved = toPosix(
        path.posix.normalize(
          path.posix.join(path.posix.dirname(sourcePath), specifier),
        ),
      );
      const targetModuleMatch = resolved.match(
        /apps\/(api|worker)\/src\/modules\/([^/]+)\/(.+)$/,
      );

      if (
        !sourceModule &&
        targetModuleMatch &&
        sourcePath.startsWith(`apps/${targetModuleMatch[1]}/src/`) &&
        !(targetModuleMatch[1] === "worker"
          ? /^index(?:\.[cm]?tsx?)?$/.test(targetModuleMatch[3])
          : /^(?:public|composition)(?:\.[cm]?tsx?)?$/.test(targetModuleMatch[3]))
      ) {
        violations.push({
          path: sourcePath,
          import: specifier,
          rule: "composition-uses-public-module-entrypoint",
        });
      }

      const sourceLayer = sourcePath.match(
        /apps\/api\/src\/modules\/[^/]+\/(application|domain|public(?:\.[cm]?tsx?)?)/,
      )?.[1];
      const targetLayer = targetModuleMatch?.[3].split("/")[0];

      if (
        sourceModule &&
        sourceLayer &&
        targetModuleMatch &&
        targetModuleMatch[2] === sourceModule &&
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
        targetModuleMatch[1] === sourceRuntime &&
        targetModuleMatch[2] !== sourceModule &&
        !(sourceRuntime === "worker"
          ? /^index(?:\.[cm]?tsx?)?$/.test(targetModuleMatch[3])
          : /^public(?:\.[cm]?tsx?)?$/.test(targetModuleMatch[3]))
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
  const publishedLegacyOwners = new Map([
    [
      "packages/database/prisma/migrations/20260824174500__product__state_transition_truncate_guard/migration.sql",
      "product",
    ],
  ]);

  for (const migrationPath of paths.map(toPosix)) {
    const match = migrationPath.match(convention);
    const owner = match?.[1] ?? publishedLegacyOwners.get(migrationPath);
    if (!owner) {
      violations.push({
        path: migrationPath,
        rule: "migration-directory-convention",
      });
      continue;
    }

    if (!registeredModules.has(owner)) {
      violations.push({
        path: migrationPath,
        rule: "registered-migration-owner",
      });
    }
  }

  return violations;
}

function unqualifiedSqlIdentifier(identifier) {
  if (!identifier) return undefined;
  return identifier.split(".").at(-1)?.trim().replace(/^"|"$/g, "");
}

function sqlIdentifierList(source) {
  return [...source.matchAll(/"[^"]+"|[a-z_][a-z0-9_$]*/gi)]
    .map(([identifier]) => unqualifiedSqlIdentifier(identifier))
    .filter(Boolean);
}

function splitSqlStatements(source) {
  const statements = [];
  let statement = "";
  let state = "normal";
  let blockCommentDepth = 0;
  let dollarQuote = "";
  let singleQuoteBackslashEscapes = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") {
        state = "normal";
        statement += character;
      } else {
        statement += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "/" && next === "*") {
        blockCommentDepth += 1;
        statement += "  ";
        index += 1;
      } else if (character === "*" && next === "/") {
        blockCommentDepth -= 1;
        statement += "  ";
        index += 1;
        if (blockCommentDepth === 0) state = "normal";
      } else {
        statement += character === "\n" ? character : " ";
      }
      continue;
    }

    if (state === "single-quote") {
      statement += character === "\n" ? character : " ";
      if (singleQuoteBackslashEscapes && character === "\\" && next) {
        statement += next === "\n" ? next : " ";
        index += 1;
      } else if (character === "'" && next === "'") {
        statement += " ";
        index += 1;
      } else if (character === "'") {
        state = "normal";
      }
      continue;
    }

    if (state === "double-quote") {
      statement += character;
      if (character === '"' && next === '"') {
        statement += next;
        index += 1;
      } else if (character === '"') {
        state = "normal";
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (source.startsWith(dollarQuote, index)) {
        statement += " ".repeat(dollarQuote.length);
        index += dollarQuote.length - 1;
        state = "normal";
      } else {
        statement += character === "\n" ? character : " ";
      }
      continue;
    }

    if (character === "-" && next === "-") {
      state = "line-comment";
      statement += "  ";
      index += 1;
    } else if (character === "/" && next === "*") {
      state = "block-comment";
      blockCommentDepth = 1;
      statement += "  ";
      index += 1;
    } else if (character === "'") {
      state = "single-quote";
      singleQuoteBackslashEscapes =
        /e/i.test(source[index - 1] ?? "") &&
        !/[a-z0-9_$]/i.test(source[index - 2] ?? "");
      statement += " ";
    } else if (character === '"') {
      state = "double-quote";
      statement += character;
    } else if (character === "$") {
      const tag = source.slice(index).match(/^\$[a-z_][a-z0-9_]*\$|^\$\$/i)?.[0];
      if (tag) {
        state = "dollar-quote";
        dollarQuote = tag;
        statement += " ".repeat(tag.length);
        index += tag.length - 1;
      } else {
        statement += character;
      }
    } else if (character === ";") {
      if (statement.trim()) statements.push(statement);
      statement = "";
    } else {
      statement += character;
    }
  }

  if (statement.trim()) statements.push(statement);
  return statements;
}

function inferredForeignKeyDefinition(sourceTable, statement, referenceIndex) {
  const beforeReference = statement.slice(0, referenceIndex);
  const foreignKeyMatches = [
    ...beforeReference.matchAll(
      /(?:constraint\s+((?:"[^"]+"|[a-z_][a-z0-9_$]*))\s+)?foreign\s+key\s*\(([^)]*)\)/gi,
    ),
  ];
  const tableForeignKey = foreignKeyMatches.at(-1);
  if (tableForeignKey) {
    const explicitName = unqualifiedSqlIdentifier(tableForeignKey[1]);
    const sourceColumns = sqlIdentifierList(tableForeignKey[2]);
    return {
      constraintName:
        explicitName ??
        (sourceColumns.length > 0
          ? `${sourceTable}_${sourceColumns.join("_")}_fkey`
          : undefined),
      sourceColumns,
    };
  }

  const columnDefinition = beforeReference.slice(
    Math.max(beforeReference.lastIndexOf(","), beforeReference.lastIndexOf("(")) + 1,
  );
  const inlineConstraintName = unqualifiedSqlIdentifier(
    columnDefinition.match(/\bconstraint\s+((?:"[^"]+"|[a-z_][a-z0-9_$]*))\s*$/i)?.[1],
  );
  const columnName = unqualifiedSqlIdentifier(
    columnDefinition.match(
      /^\s*(?:add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?)?((?:"[^"]+"|[a-z_][a-z0-9_$]*))/i,
    )?.[1],
  );
  return {
    constraintName:
      inlineConstraintName ??
      (columnName ? `${sourceTable}_${columnName}_fkey` : undefined),
    sourceColumns: columnName ? [columnName] : [],
  };
}

export function findCrossModuleMigrationForeignKeyViolations(migrations, tableOwners) {
  const activeViolations = new Map();
  const tableStatementPattern =
    /^\s*(?:create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_$]*))?)|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_$]*))?))([\s\S]*)$/i;
  const referencePattern =
    /\breferences\s+((?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_$]*))?)(?:\s*\(([^)]*)\))?/gi;

  const dropConstraintPattern =
    /\bdrop\s+constraint\s+(?:if\s+exists\s+)?((?:"[^"]+"|[a-z_][a-z0-9_$]*))/gi;
  const dropColumnPattern =
    /\bdrop\s+(?!constraint\b)(?:column\s+)?(?:if\s+exists\s+)?((?:"[^"]+"|[a-z_][a-z0-9_$]*))/gi;
  const dropTablePattern =
    /^\s*drop\s+table\s+(?:if\s+exists\s+)?([\s\S]*?)(?:\s+(?:cascade|restrict))?\s*$/i;

  for (const migration of [...migrations].sort((left, right) =>
    toPosix(left.path).localeCompare(toPosix(right.path)),
  )) {
    for (const sqlStatement of splitSqlStatements(migration.source)) {
      const droppedTables = sqlStatement.match(dropTablePattern)?.[1];
      if (droppedTables) {
        const tableNames = droppedTables
          .split(",")
          .map((identifier) => unqualifiedSqlIdentifier(identifier))
          .filter(Boolean);
        for (const [key, violation] of activeViolations) {
          if (
            tableNames.includes(violation.sourceTable) ||
            tableNames.includes(violation.targetTable)
          ) {
            activeViolations.delete(key);
          }
        }
        continue;
      }

      const statement = sqlStatement.match(tableStatementPattern);
      if (!statement) continue;
      const sourceTable = unqualifiedSqlIdentifier(statement[1] ?? statement[2]);
      if (!sourceTable) continue;
      const sourceOwner = tableOwners[sourceTable];
      const statementBody = statement[3] ?? "";

      const actions = [
        ...[...statementBody.matchAll(dropConstraintPattern)].map((match) => ({
          index: match.index,
          kind: "drop-constraint",
          match,
        })),
        ...[...statementBody.matchAll(dropColumnPattern)].map((match) => ({
          index: match.index,
          kind: "drop-column",
          match,
        })),
        ...[...statementBody.matchAll(referencePattern)].map((match) => ({
          index: match.index,
          kind: "reference",
          match,
        })),
      ].sort((left, right) => left.index - right.index);

      for (const action of actions) {
        if (action.kind === "drop-constraint") {
          const constraintName = unqualifiedSqlIdentifier(action.match[1]);
          if (constraintName)
            activeViolations.delete(`${sourceTable}.${constraintName}`);
          continue;
        }

        if (action.kind === "drop-column") {
          const columnName = unqualifiedSqlIdentifier(action.match[1]);
          if (!columnName) continue;
          for (const [key, violation] of activeViolations) {
            if (
              (violation.sourceTable === sourceTable &&
                violation.sourceColumns.includes(columnName)) ||
              (violation.targetTable === sourceTable &&
                violation.targetColumns.includes(columnName))
            ) {
              activeViolations.delete(key);
            }
          }
          continue;
        }

        const targetTable = unqualifiedSqlIdentifier(action.match[1]);
        if (!targetTable) continue;
        const targetOwner = tableOwners[targetTable];
        if (sourceOwner && targetOwner && sourceOwner !== targetOwner) {
          const { constraintName, sourceColumns } = inferredForeignKeyDefinition(
            sourceTable,
            statementBody,
            action.match.index,
          );
          const targetColumns = sqlIdentifierList(action.match[2] ?? "");
          activeViolations.set(`${sourceTable}.${constraintName ?? targetTable}`, {
            path: toPosix(migration.path),
            sourceTable,
            targetTable,
            sourceOwner,
            targetOwner,
            sourceColumns,
            targetColumns,
            ...(constraintName ? { constraintName } : {}),
            rule: "cross-module-migration-foreign-key",
          });
        }
      }
    }
  }

  return [...activeViolations.values()].map((violation) => {
    const reportedViolation = { ...violation };
    delete reportedViolation.sourceColumns;
    delete reportedViolation.targetColumns;
    return reportedViolation;
  });
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

export function findContractOwnershipViolations(contractOwners, registeredModules) {
  return Object.entries(contractOwners)
    .filter(([, owner]) => !registeredModules.has(owner))
    .map(([contract, owner]) => ({
      contract,
      owner,
      rule: "registered-contract-owner-module",
    }));
}

export function findCanonicalModuleEntrypointViolations(
  registeredModules,
  repositoryPaths,
) {
  const violations = [];
  const requiredPaths = (moduleName) => [
    `apps/api/src/modules/${moduleName}/public.ts`,
    `apps/api/src/modules/${moduleName}/composition.ts`,
    `apps/api/src/openapi/modules/${moduleName}.ts`,
    `apps/worker/src/modules/${moduleName}/index.ts`,
    `packages/contracts/src/${moduleName}/v1/index.ts`,
    `packages/database/prisma/schema/${moduleName}.prisma`,
  ];

  for (const moduleName of [...registeredModules].sort()) {
    for (const requiredPath of requiredPaths(moduleName)) {
      if (!repositoryPaths.has(requiredPath)) {
        violations.push({ path: requiredPath, rule: "canonical-module-entrypoint" });
      }
    }
  }

  return violations;
}

export function findModuleSchemaOwnershipViolations(schemaFiles, tableOwners) {
  const violations = [];
  const modelPattern = /model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g;
  const modelOwners = new Map();

  for (const file of schemaFiles) {
    const declaredOwner = path.posix.basename(toPosix(file.path), ".prisma");
    for (const match of file.source.matchAll(modelPattern)) {
      if (match[1]) modelOwners.set(match[1], declaredOwner);
    }
  }

  for (const file of schemaFiles) {
    const declaredOwner = path.posix.basename(toPosix(file.path), ".prisma");
    if (declaredOwner === "base") continue;

    for (const match of file.source.matchAll(modelPattern)) {
      const modelName = match[1];
      const body = match[2] ?? "";
      const tableName = body.match(/@@map\(\s*["']([^"']+)["']\s*\)/)?.[1] ?? modelName;
      if (tableOwners[tableName] !== declaredOwner) {
        violations.push({
          path: toPosix(file.path),
          table: tableName,
          owner: tableOwners[tableName],
          declaredOwner,
          rule: "module-schema-owns-table",
        });
      }

      for (const field of body.matchAll(
        /^\s*[A-Za-z][A-Za-z0-9_]*\s+([A-Z][A-Za-z0-9_]*)(?:\[\]|\?)?(?:\s|$)/gm,
      )) {
        const targetModel = field[1];
        const targetOwner = targetModel ? modelOwners.get(targetModel) : undefined;
        if (targetOwner && targetOwner !== declaredOwner) {
          violations.push({
            path: toPosix(file.path),
            model: modelName,
            targetModel,
            owner: declaredOwner,
            targetOwner,
            rule: "cross-module-prisma-relation",
          });
        }
      }
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
    visit(path.join(root, "apps", "worker", "src")),
  ]);
  return files;
}

async function collectMigrations(root) {
  const migrationRoot = path.join(root, "packages", "database", "prisma", "migrations");
  const migrations = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.name === "migration.sql") {
        migrations.push({
          path: toPosix(path.relative(root, absolutePath)),
          source: await readFile(absolutePath, "utf8"),
        });
      }
    }
  }

  await visit(migrationRoot);
  return migrations;
}

async function collectFiles(root, directory, predicate = () => true) {
  const files = [];

  async function visit(currentDirectory) {
    let entries;
    try {
      entries = await readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (predicate(entry.name)) {
        files.push({
          path: toPosix(path.relative(root, absolutePath)),
          source: await readFile(absolutePath, "utf8"),
        });
      }
    }
  }

  await visit(path.join(root, directory));
  return files;
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
  const registeredDataOwners = new Set([
    ...registeredModules,
    ...(ownership.infrastructureOwners ?? []),
  ]);
  const schemaFiles = await collectFiles(
    root,
    path.join("packages", "database", "prisma", "schema"),
    (name) => name.endsWith(".prisma"),
  );
  const databaseSchema = schemaFiles.map(({ source }) => source).join("\n");
  const entrypointFiles = await Promise.all([
    collectFiles(root, path.join("apps", "api", "src", "modules")),
    collectFiles(root, path.join("apps", "api", "src", "openapi", "modules")),
    collectFiles(root, path.join("apps", "worker", "src", "modules")),
    collectFiles(root, path.join("packages", "contracts", "src")),
    collectFiles(root, path.join("packages", "database", "prisma", "schema")),
  ]);
  const repositoryPaths = new Set(
    entrypointFiles.flat().map(({ path: filePath }) => filePath),
  );
  const migrations = await collectMigrations(root);
  const violations = [
    ...findBoundaryViolations(await collectSources(root)),
    ...findCanonicalModuleEntrypointViolations(registeredModules, repositoryPaths),
    ...findMigrationOwnershipViolations(
      migrations.map(({ path: migrationPath }) => migrationPath),
      registeredDataOwners,
    ),
    ...findCrossModuleMigrationForeignKeyViolations(migrations, ownership.tables),
    ...findTableOwnershipViolations(
      databaseSchema,
      ownership.tables,
      registeredDataOwners,
    ),
    ...findModuleSchemaOwnershipViolations(schemaFiles, ownership.tables),
    ...findContractOwnershipViolations(ownership.contracts ?? {}, registeredDataOwners),
  ];

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `${violation.path ?? violation.table ?? violation.contract}: ${violation.rule}${violation.import ? ` (${violation.import})` : ""}`,
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
