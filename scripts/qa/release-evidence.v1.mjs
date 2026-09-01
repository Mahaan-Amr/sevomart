import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MIGRATION_PATTERN = /^\d{14}__[a-z0-9-]+__[a-z0-9-]+$/;
const MANDATORY_SCENARIOS = [
  "success",
  "empty",
  "loading",
  "validation",
  "domain-error",
  "access-denied",
  "resource-unavailable",
  "provider-server-failure",
  "recovery",
];
const CONDITIONAL_SCENARIOS = [
  "concurrency",
  "idempotency",
  "expiry",
  "ambiguous-result",
];

export const RELEASE_EVIDENCE_CONTRACT_VERSION = 1;

export function validateReleaseEvidenceManifest(manifest) {
  if (
    manifest?.schemaVersion !== RELEASE_EVIDENCE_CONTRACT_VERSION ||
    manifest.contract !== "release-evidence.v1"
  ) {
    throw new Error("Release evidence manifest must use release-evidence.v1");
  }

  assertUniqueIds(manifest.spaces, "space");
  assertUniqueIds(manifest.identities, "identity");
  assertUniqueIds(manifest.journeys, "journey");

  const spaceIds = new Set(manifest.spaces.map(({ id }) => id));
  const identityIds = new Set(manifest.identities.map(({ id }) => id));
  const stateIds = new Set([
    ...manifest.scenarios.required,
    ...manifest.scenarios.conditional,
  ]);

  assertIncludes(
    manifest.scenarios.required,
    MANDATORY_SCENARIOS,
    "mandatory scenarios",
  );
  assertIncludes(
    manifest.scenarios.conditional,
    CONDITIONAL_SCENARIOS,
    "conditional scenarios",
  );
  assertIncludes(
    manifest.coverage?.viewports,
    ["360x800", "390x844", "768x1024", "1440x900", "zoom-200"],
    "candidate viewports",
  );
  assertIncludes(
    manifest.coverage?.browsers,
    ["chromium", "webkit"],
    "candidate browsers",
  );
  assertIncludes(
    manifest.coverage?.testLayers,
    ["unit", "contract", "integration", "e2e"],
    "test layers",
  );

  if (!["buyer", "seller", "platform"].every((id) => spaceIds.has(id))) {
    throw new Error("Release evidence manifest must cover buyer, seller and platform");
  }
  if (
    !["buyer", "seller", "applicant", "review-agent", "access-manager"].every((id) =>
      identityIds.has(id),
    )
  ) {
    throw new Error("Release evidence manifest must cover all five demo identities");
  }
  if (
    manifest.policy?.candidateRuns !== 2 ||
    manifest.policy?.retries !== 0 ||
    manifest.policy?.retentionDays !== 30 ||
    manifest.policy?.failOnUnexpectedConsoleError !== true ||
    manifest.policy?.failOnUnexpectedPageError !== true ||
    manifest.policy?.failOnUnexpectedNetworkError !== true ||
    manifest.policy?.externalNetwork !== "forbidden" ||
    manifest.policy?.independentReviewer !== true
  ) {
    throw new Error("Release candidate policy is incomplete");
  }
  assertIncludes(
    manifest.policy?.forbiddenOutcomes,
    ["SKIPPED", "QUARANTINED", "RETRIED"],
    "forbidden outcomes",
  );

  for (const journey of manifest.journeys) {
    if (!spaceIds.has(journey.space)) {
      throw new Error(`Journey ${journey.id} references an unknown space`);
    }
    if (
      !journey.identities?.length ||
      journey.identities.some((id) => !identityIds.has(id))
    ) {
      throw new Error(`Journey ${journey.id} references an unknown identity`);
    }
    if (journey.additionalScenarios?.some((id) => !stateIds.has(id))) {
      throw new Error(`Journey ${journey.id} references an unknown scenario`);
    }
    for (const layer of manifest.coverage.testLayers) {
      if (!journey.tests?.[layer]?.length) {
        throw new Error(`Journey ${journey.id} has no ${layer} test trace`);
      }
    }
  }

  return manifest;
}

export function createReleaseEvidencePlan(
  manifest,
  metadata,
  { now = new Date() } = {},
) {
  validateReleaseEvidenceManifest(manifest);
  validateCandidateMetadata(metadata);

  const createdAt = new Date(now);
  if (Number.isNaN(createdAt.getTime())) throw new Error("Evidence time must be valid");
  const retentionUntil = new Date(createdAt);
  retentionUntil.setUTCDate(
    retentionUntil.getUTCDate() + manifest.policy.retentionDays,
  );

  const cells = createEvidenceCells(manifest);

  return {
    contractVersion: RELEASE_EVIDENCE_CONTRACT_VERSION,
    manifestVersion: manifest.manifestVersion,
    claim: manifest.claim,
    status: "PENDING",
    createdAt: createdAt.toISOString(),
    retentionUntil: retentionUntil.toISOString(),
    candidateRuns: manifest.policy.candidateRuns,
    candidate: structuredClone(metadata),
    policy: structuredClone(manifest.policy),
    approvals: [],
    runs: [],
    cells,
  };
}

export function finalizeReleaseEvidence(
  manifest,
  evidence,
  {
    now = new Date(),
    verifyArtifact = verifyReleaseEvidenceArtifact,
    readReceipt = readReleaseEvidenceReceipt,
  } = {},
) {
  validateReleaseEvidenceManifest(manifest);
  validateCandidateMetadata(evidence?.candidate);
  if (evidence?.contractVersion !== RELEASE_EVIDENCE_CONTRACT_VERSION) {
    throw new Error("Evidence pack uses an unsupported contract version");
  }
  verifyCandidateArtifacts(evidence.candidate, verifyArtifact);
  assertRetention(manifest, evidence);
  if (
    !Array.isArray(evidence.runs) ||
    evidence.runs.length !== manifest.policy.candidateRuns
  ) {
    throw new Error(
      `Evidence pack requires exactly ${manifest.policy.candidateRuns} runs`,
    );
  }

  const fingerprints = new Set();
  const expectedCells = new Map(
    createEvidenceCells(manifest).map((cell) => [cell.cellId, cell]),
  );
  const reportedCellIds = new Set(evidence.cells?.map(({ cellId }) => cellId) ?? []);
  if (
    reportedCellIds.size !== expectedCells.size ||
    reportedCellIds.size !== evidence.cells?.length ||
    [...expectedCells.keys()].some((cellId) => !reportedCellIds.has(cellId))
  ) {
    throw new Error("Evidence plan does not match the manifest");
  }

  for (const run of evidence.runs) {
    if (
      typeof run.environmentFingerprint !== "string" ||
      run.environmentFingerprint.length < 16 ||
      fingerprints.has(run.environmentFingerprint)
    ) {
      throw new Error("Candidate runs require distinct fresh environment fingerprints");
    }
    fingerprints.add(run.environmentFingerprint);
    assertRunMetadata(run, evidence.candidate);
    const receiptCells = assertRunReceipt(
      run,
      evidence.candidate,
      expectedCells,
      verifyArtifact,
      readReceipt,
    );

    const observations = new Map(
      run.observations?.map((observation) => [observation.cellId, observation]) ?? [],
    );
    if (
      observations.size !== expectedCells.size ||
      observations.size !== run.observations?.length
    ) {
      throw new Error(`Run ${run.runId} must report every evidence cell exactly once`);
    }

    for (const [cellId, cell] of expectedCells) {
      const observation = observations.get(cellId);
      if (!observation)
        throw new Error(`Run ${run.runId} is missing evidence cell ${cellId}`);
      validateObservation(
        manifest,
        evidence.candidate,
        evidence.retentionUntil,
        run,
        cell,
        receiptCells.get(cellId),
        observation,
        verifyArtifact,
      );
    }
  }

  const approvals = new Set(evidence.approvals ?? []);
  if (approvals.size < 2 || !approvals.has(evidence.candidate.author)) {
    throw new Error(
      "Final evidence approval requires both developers, including the author",
    );
  }

  const finalizedAt = new Date(now);
  if (Number.isNaN(finalizedAt.getTime()))
    throw new Error("Finalization time must be valid");
  return structuredClone({
    ...evidence,
    status: "APPROVED",
    finalizedAt: finalizedAt.toISOString(),
  });
}

export function verifyReleaseEvidenceArtifact(artifact) {
  const bytes = readFileSync(resolve(artifact.ref));
  return createHash("sha256").update(bytes).digest("hex") === artifact.sha256;
}

export function readReleaseEvidenceReceipt(artifact) {
  return JSON.parse(readFileSync(resolve(artifact.ref), "utf8"));
}

function verifyCandidateArtifacts(candidate, verifyArtifact) {
  for (const artifact of [
    ...Object.values(candidate.health),
    ...Object.values(candidate.startup),
  ]) {
    if (verifyArtifact(artifact) !== true) {
      throw new Error(
        "Candidate health or startup artifact failed integrity verification",
      );
    }
  }
}

function assertRunReceipt(run, candidate, expectedCells, verifyArtifact, readReceipt) {
  const receipt = run.receipt;
  if (
    !validCandidateArtifact(receipt, candidate) ||
    receipt.runId !== run.runId ||
    verifyArtifact(receipt) !== true
  ) {
    throw new Error(`Run ${run.runId} has no valid candidate receipt`);
  }
  const content = readReceipt(receipt);
  if (
    content?.contractVersion !== 1 ||
    content.runId !== run.runId ||
    content.sha !== candidate.sha ||
    content.migration !== candidate.migration ||
    content.seedVersion !== candidate.seedVersion ||
    content.status !== "PASSED" ||
    content.retries !== 0 ||
    content.skipped !== 0 ||
    content.quarantined !== 0 ||
    content.unexpectedConsoleErrors !== 0 ||
    content.unexpectedPageErrors !== 0 ||
    content.unexpectedNetworkErrors !== 0
  ) {
    throw new Error(`Run ${run.runId} candidate receipt did not pass cleanly`);
  }
  const receiptCells = new Map(content.cells?.map((cell) => [cell.cellId, cell]) ?? []);
  if (
    receiptCells.size !== expectedCells.size ||
    [...expectedCells.keys()].some((cellId) => !receiptCells.has(cellId))
  ) {
    throw new Error(`Run ${run.runId} receipt does not cover the evidence matrix`);
  }
  return receiptCells;
}

function createEvidenceCells(manifest) {
  return manifest.journeys.flatMap((journey) =>
    [...manifest.scenarios.required, ...(journey.additionalScenarios ?? [])].map(
      (scenario) => ({
        cellId: `${journey.id}:${scenario}`,
        space: journey.space,
        journeyId: journey.id,
        identityIds: [...journey.identities],
        scenario,
        browsers: [...journey.browsers],
        viewports: [...manifest.coverage.viewports],
        testLayers: Object.fromEntries(
          manifest.coverage.testLayers.map((layer) => [
            layer,
            [...journey.tests[layer]],
          ]),
        ),
        artifactKinds: [...manifest.coverage.artifactKinds],
        reviewRisk: journey.reviewRisk,
      }),
    ),
  );
}

function validateCandidateMetadata(metadata) {
  if (!SHA_PATTERN.test(metadata?.sha ?? "")) {
    throw new Error("Candidate SHA must be a lowercase 40-character commit hash");
  }
  if (!MIGRATION_PATTERN.test(metadata?.migration ?? "")) {
    throw new Error("Candidate migration must name the exact predecessor migration");
  }
  if (!Number.isInteger(metadata?.seedVersion) || metadata.seedVersion < 1) {
    throw new Error("Candidate seed version must be a positive integer");
  }
  if (!metadata?.author?.trim()) throw new Error("Candidate author is required");
  for (const service of ["api", "web", "worker"]) {
    if (!validCandidateArtifact(metadata?.health?.[service], metadata)) {
      throw new Error(`Candidate health artifact for ${service} is required`);
    }
  }
  for (const startupPath of ["docker", "native"]) {
    if (!validCandidateArtifact(metadata?.startup?.[startupPath], metadata)) {
      throw new Error(`Candidate startup artifact for ${startupPath} is required`);
    }
  }
}

function validCandidateArtifact(artifact, candidate) {
  return (
    typeof artifact?.ref === "string" &&
    artifact.ref.length > 0 &&
    /^[0-9a-f]{64}$/.test(artifact.sha256 ?? "") &&
    artifact.sha === candidate.sha &&
    artifact.migration === candidate.migration &&
    artifact.seedVersion === candidate.seedVersion
  );
}

function assertRunMetadata(run, candidate) {
  for (const field of ["sha", "migration", "seedVersion"]) {
    if (run[field] !== candidate[field]) {
      throw new Error(`Run ${run.runId} does not match candidate ${field}`);
    }
  }
  for (const service of ["api", "web", "worker"]) {
    if (
      JSON.stringify(run.health?.[service]) !==
      JSON.stringify(candidate.health[service])
    ) {
      throw new Error(`Run ${run.runId} does not link candidate ${service} health`);
    }
  }
}

function validateObservation(
  manifest,
  candidate,
  retentionUntil,
  run,
  cell,
  receiptCell,
  observation,
  verifyArtifact,
) {
  if (manifest.policy.forbiddenOutcomes.includes(observation.outcome)) {
    throw new Error(
      `Evidence cell ${cell.cellId} has forbidden outcome ${observation.outcome}`,
    );
  }
  if (observation.outcome !== "PASSED") {
    throw new Error(`Evidence cell ${cell.cellId} did not pass`);
  }
  if (observation.retryCount !== 0) {
    throw new Error(`Evidence cell ${cell.cellId} used a retry`);
  }
  if (observation.unexpectedConsoleErrors?.length) {
    throw new Error(`Evidence cell ${cell.cellId} has an unexpected console error`);
  }
  if (observation.unexpectedPageErrors?.length) {
    throw new Error(`Evidence cell ${cell.cellId} has an unexpected page error`);
  }
  if (observation.unexpectedNetworkErrors?.length) {
    throw new Error(`Evidence cell ${cell.cellId} has an unexpected network error`);
  }
  if (!observation.reviewer?.trim() || observation.reviewer === candidate.author) {
    throw new Error(`Evidence cell ${cell.cellId} requires an independent reviewer`);
  }
  if (Number.isNaN(Date.parse(observation.reviewedAt ?? ""))) {
    throw new Error(`Evidence cell ${cell.cellId} requires a review timestamp`);
  }
  assertCoverage(cell, receiptCell, observation);

  const artifactKinds = new Set(
    observation.artifacts
      ?.filter((artifact) => {
        if (
          typeof artifact.ref !== "string" ||
          !artifact.ref.trim() ||
          !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? "") ||
          artifact.runId !== run.runId ||
          artifact.cellId !== cell.cellId ||
          artifact.sha !== candidate.sha ||
          artifact.migration !== candidate.migration ||
          artifact.seedVersion !== candidate.seedVersion ||
          artifact.retentionUntil !== retentionUntil ||
          verifyArtifact(artifact) !== true
        ) {
          throw new Error(
            `Evidence cell ${cell.cellId} has an invalid artifact binding`,
          );
        }
        return true;
      })
      .map(({ kind }) => kind) ?? [],
  );
  for (const kind of cell.artifactKinds) {
    if (!artifactKinds.has(kind)) {
      throw new Error(`Evidence cell ${cell.cellId} is missing ${kind}`);
    }
  }
}

function assertCoverage(cell, receiptCell, observation) {
  for (const [kind, required] of [
    ["browser", cell.browsers],
    ["viewport", cell.viewports],
  ]) {
    const reported = new Set(observation.coverage?.[`${kind}s`] ?? []);
    if (!required.every((value) => reported.has(value))) {
      throw new Error(`Evidence cell ${cell.cellId} is missing ${kind} coverage`);
    }
    const receipted = new Set(receiptCell?.[`${kind}s`] ?? []);
    if (!required.every((value) => receipted.has(value))) {
      throw new Error(`Evidence receipt ${cell.cellId} is missing ${kind} coverage`);
    }
  }
  for (const layer of Object.keys(cell.testLayers)) {
    const cases = observation.coverage?.testLayers?.[layer];
    const receiptedCases = new Set(receiptCell?.testLayers?.[layer] ?? []);
    if (
      !Array.isArray(cases) ||
      cases.length === 0 ||
      cases.some((value) => !value || !receiptedCases.has(value))
    ) {
      throw new Error(`Evidence cell ${cell.cellId} is missing ${layer} case coverage`);
    }
  }
}

function assertRetention(manifest, evidence) {
  const createdAt = new Date(evidence?.createdAt ?? "");
  const expectedRetention = new Date(createdAt);
  expectedRetention.setUTCDate(
    expectedRetention.getUTCDate() + manifest.policy.retentionDays,
  );
  if (
    Number.isNaN(createdAt.getTime()) ||
    evidence.retentionUntil !== expectedRetention.toISOString()
  ) {
    throw new Error("Evidence retention does not match the 30-day candidate policy");
  }
}

function assertUniqueIds(entries, kind) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`Release evidence manifest requires ${kind} entries`);
  }
  const ids = entries.map(({ id }) => id);
  if (
    ids.some((id) => typeof id !== "string" || !id) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error(`Release evidence manifest ${kind} ids must be unique`);
  }
}

function assertIncludes(actual, required, kind) {
  const values = new Set(actual ?? []);
  if (!required.every((value) => values.has(value))) {
    throw new Error(`Release evidence manifest is missing ${kind}`);
  }
}
