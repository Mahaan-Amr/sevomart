import { createQaScenarioProcessEnvironment } from "./scenario-environment.mjs";

const RELEASE_CANDIDATE_LAYERS = [
  "build:packages",
  "test:unit",
  "test:contract",
  "test:integration",
];

export function releaseCandidateLayerEnvironment(script, candidateEnvironment) {
  return script === "test:integration"
    ? createQaScenarioProcessEnvironment(candidateEnvironment)
    : candidateEnvironment;
}

export function runReleaseCandidateLayers(runScript, candidateName = "Candidate") {
  for (const script of RELEASE_CANDIDATE_LAYERS) {
    if (runScript(script) !== 0) {
      throw new Error(`${candidateName} failed ${script}`);
    }
  }
}
