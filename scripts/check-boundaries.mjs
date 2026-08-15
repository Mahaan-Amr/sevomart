import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const importPattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

export function findBoundaryViolations(files) {
  const violations = [];

  for (const file of files) {
    const sourcePath = toPosix(file.path);
    const sourceModule = sourcePath.match(/apps\/api\/src\/modules\/([^/]+)\//)?.[1];

    for (const match of file.source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier) continue;

      const resolved = toPosix(
        path.posix.normalize(
          path.posix.join(path.posix.dirname(sourcePath), specifier),
        ),
      );
      const targetModuleMatch = resolved.match(
        /apps\/api\/src\/modules\/([^/]+)\/(.+)$/,
      );

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

async function main() {
  const root = process.cwd();
  const violations = findBoundaryViolations(await collectSources(root));

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.path}: ${violation.rule} (${violation.import})`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Architecture boundaries are valid.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
