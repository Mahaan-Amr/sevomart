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
await mkdir(path.join(moduleDirectory, "application"), { recursive: true });
await mkdir(path.join(moduleDirectory, "domain"), { recursive: true });
await mkdir(path.join(moduleDirectory, "infrastructure"), { recursive: true });
await mkdir(path.join(moduleDirectory, "testing"), { recursive: true });
await writeFile(
  path.join(moduleDirectory, "public.ts"),
  "// Export only the stable synchronous contracts owned by this module.\n",
  { flag: "wx" },
);

console.log(`Created ${path.relative(root, moduleDirectory)}`);
