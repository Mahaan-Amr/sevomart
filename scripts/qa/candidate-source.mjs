import { execFileSync } from "node:child_process";

export function assertCleanCandidate(expectedSha) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (expectedSha && head !== expectedSha) {
    throw new Error("Candidate HEAD changed during evidence collection");
  }
  const changes = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    {
      encoding: "utf8",
    },
  );
  if (changes.trim()) {
    throw new Error(
      "Release evidence requires a clean working tree, including untracked source",
    );
  }
  return head;
}
