import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const volumes = ["sevomart_postgres-data", "sevomart_minio-data"];
console.log(
  "این فرمان volumeهای زیر و همهٔ فروشگاه‌ها و رسانه‌های محلی آن‌ها را حذف می‌کند:",
);
for (const volume of volumes) console.log(`- ${volume}`);

const approved = process.argv.includes("--yes") && process.env.CI === "true";
if (!approved) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(
    'برای حذف دقیقاً عبارت "DELETE SEVO LOCAL DATA" را بنویسید: ',
  );
  prompt.close();
  if (answer !== "DELETE SEVO LOCAL DATA") {
    console.log("حذف لغو شد.");
    process.exit(1);
  }
}

const stopped = spawnSync("docker", ["compose", "down"], {
  shell: process.platform === "win32",
  stdio: "inherit",
});
if (stopped.status !== 0) process.exit(stopped.status ?? 1);

const result = spawnSync("docker", ["volume", "rm", ...volumes], {
  shell: process.platform === "win32",
  stdio: "inherit",
});
process.exit(result.status ?? 1);
