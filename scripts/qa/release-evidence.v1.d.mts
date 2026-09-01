export const RELEASE_EVIDENCE_CONTRACT_VERSION: 1;

export type ReleaseEvidenceCandidate = Readonly<{
  sha: string;
  migration: string;
  seedVersion: number;
  health: Readonly<Record<"api" | "web" | "worker", CandidateArtifact>>;
  startup: Readonly<Record<"docker" | "native", CandidateArtifact>>;
  author: string;
}>;

export type CandidateArtifact = Readonly<{
  ref: string;
  sha256: string;
  sha: string;
  migration: string;
  seedVersion: number;
}>;

export type ReleaseEvidencePlan = Readonly<{
  contractVersion: 1;
  manifestVersion: number;
  claim: string;
  status: "PENDING" | "APPROVED";
  createdAt: string;
  retentionUntil: string;
  candidateRuns: 2;
  candidate: ReleaseEvidenceCandidate;
  approvals: string[];
  runs: unknown[];
  cells: ReadonlyArray<
    Readonly<{
      cellId: string;
      journeyId: string;
      space: "buyer" | "seller" | "platform";
      identityIds: string[];
      scenario: string;
      browsers: string[];
      viewports: string[];
      testLayers: Record<"unit" | "contract" | "integration" | "e2e", string[]>;
      artifactKinds: string[];
      reviewRisk: "standard" | "high";
    }>
  >;
}>;

export function validateReleaseEvidenceManifest<Manifest>(manifest: Manifest): Manifest;

export function createReleaseEvidencePlan(
  manifest: unknown,
  metadata: ReleaseEvidenceCandidate,
  options?: Readonly<{ now?: Date }>,
): ReleaseEvidencePlan;

export function finalizeReleaseEvidence(
  manifest: unknown,
  evidence: ReleaseEvidencePlan,
  options: Readonly<{
    now?: Date;
    verifyArtifact?(artifact: Readonly<Record<string, unknown>>): boolean;
    readReceipt?(
      artifact: Readonly<Record<string, unknown>>,
    ): Readonly<Record<string, unknown>>;
  }>,
): ReleaseEvidencePlan & Readonly<{ status: "APPROVED"; finalizedAt: string }>;

export function verifyReleaseEvidenceArtifact(
  artifact: Readonly<{ ref: string; sha256: string }>,
): boolean;

export function readReleaseEvidenceReceipt(
  artifact: Readonly<{ ref: string }>,
): Readonly<Record<string, unknown>>;
