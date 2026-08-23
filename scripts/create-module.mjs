import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const moduleName = process.argv[2];
if (!moduleName || !/^[a-z][a-z0-9-]*$/.test(moduleName)) {
  throw new Error("Usage: node scripts/create-module.mjs <kebab-case-module>");
}

const root = process.cwd();
const ownership = JSON.parse(
  await readFile(
    path.join(root, "docs", "architecture", "module-ownership.json"),
    "utf8",
  ),
);
if (!ownership.modules.includes(moduleName)) {
  throw new Error(`${moduleName} is not registered in module-ownership.json`);
}

const moduleDirectory = path.join(root, "apps", "api", "src", "modules", moduleName);
const moduleClassName = `${moduleName
  .split("-")
  .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
  .join("")}Module`;
const exportName = moduleName.replaceAll("-", "_");

async function writeScaffold(relativePath, source) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  try {
    await writeFile(absolutePath, source, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

await mkdir(path.join(moduleDirectory, "application"), { recursive: true });
await mkdir(path.join(moduleDirectory, "domain"), { recursive: true });
await mkdir(path.join(moduleDirectory, "infrastructure"), { recursive: true });
await mkdir(path.join(moduleDirectory, "testing"), { recursive: true });
await writeScaffold(
  path.join("apps", "api", "src", "modules", moduleName, "public.ts"),
  "// Export only stable synchronous contracts owned by this module.\nexport {};\n",
);
await writeScaffold(
  path.join("apps", "api", "src", "modules", moduleName, "composition.ts"),
  `import { Module } from "@nestjs/common";\n\n@Module({})\nexport class ${moduleClassName} {}\n`,
);
await writeScaffold(
  path.join("apps", "api", "src", "openapi", "modules", `${moduleName}.ts`),
  `import type { OpenApiContributor } from "../public";\n\nexport const contribute_${exportName}_openApi: OpenApiContributor = (document) => document;\n`,
);
await writeScaffold(
  path.join("apps", "worker", "src", "modules", moduleName, "index.ts"),
  `import type { WorkerHandler } from "../public";\n\nexport const ${exportName}_workerHandlers: readonly WorkerHandler[] = [];\n`,
);
await writeScaffold(
  path.join("packages", "contracts", "src", moduleName, "v1", "index.ts"),
  "// This stable entrypoint is owned by the producer module.\nexport {};\n",
);
await writeScaffold(
  path.join("packages", "database", "prisma", "schema", `${moduleName}.prisma`),
  `// Tables in this file are owned by the ${moduleName} module.\n`,
);

console.log(`Ensured scaffold for ${path.relative(root, moduleDirectory)}`);
