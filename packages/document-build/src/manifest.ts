import {
  ResumeArtifactManifestSchema,
  type DocumentBuildReport,
  type ResumeArtifactManifest,
  type ResumeChangeSet,
  type ResumeContentApproval,
  type ResumeDocumentBuild,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import { documentBuildReportPassesDownloadGate, REQUIRED_DOCUMENT_GATE_KINDS } from "./quality.js";

export const RESUME_ARTIFACT_MANIFEST_VERSION = "resume-artifact-manifest-v1" as const;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface CreateResumeArtifactManifestInput {
  build: ResumeDocumentBuild;
  report: DocumentBuildReport;
  approval: ResumeContentApproval;
  changeSet: ResumeChangeSet;
  createdAt?: string;
}

/** Create the canonical reconstruction recipe for one QA-approved DOCX artifact. */
export function createResumeArtifactManifest(input: CreateResumeArtifactManifestInput): ResumeArtifactManifest {
  const { build, report, approval, changeSet } = input;
  if (!documentBuildReportPassesDownloadGate(report)) {
    throw new Error("A reproducible artifact manifest requires all document delivery gates to pass.");
  }
  if (!build.templateVersion || !build.templateHash || !report.renderEvidenceHash) {
    throw new Error("The build is missing its immutable template or render-evidence fingerprint.");
  }
  if (
    build.contentApprovalId !== approval.id ||
    build.approvedContentHash !== approval.approvedContentHash ||
    build.resumeVersionId !== approval.resumeVersionId ||
    build.changeSetId !== changeSet.id ||
    build.changeSetHash !== changeSet.contentHash ||
    approval.changeSetId !== changeSet.id ||
    approval.changeSetHash !== changeSet.contentHash
  ) {
    throw new Error("The build, approval, and change set do not describe the same artifact lineage.");
  }

  const gates = new Map(report.qualityGates?.map((entry) => [entry.kind, entry]));
  const qualityGateEvidence = REQUIRED_DOCUMENT_GATE_KINDS.map((kind) => {
    const value = gates.get(kind);
    if (value?.status !== "passed" || !value.evidenceHash) {
      throw new Error(`Delivery gate ${kind} has no immutable evidence hash.`);
    }
    return { kind, status: "passed" as const, evidenceHash: value.evidenceHash };
  });
  const contentApprovalHash = sha256(JSON.stringify(approval));
  const buildReportHash = sha256(JSON.stringify(report));
  const reproductionHash = sha256(
    JSON.stringify({
      resumeVersionId: build.resumeVersionId,
      resumeContentHash: build.approvedContentHash,
      changeSetId: changeSet.id,
      changeSetHash: changeSet.contentHash,
      factSnapshotHash: changeSet.factSnapshotHash,
      requirementSnapshotHash: changeSet.requirementSnapshotHash,
      contentApprovalHash,
      approvedPresentationHash: approval.approvedPresentationHash,
      templateId: build.templateId,
      templateVersion: build.templateVersion,
      templateHash: build.templateHash,
      builderName: build.builderName,
      builderVersion: build.builderVersion,
    }),
  );
  const identity = sha256(JSON.stringify([build.id, build.outputHash, reproductionHash]));
  const withoutHash = {
    id: `artifact-manifest:${identity.slice(0, 24)}`,
    manifestVersion: RESUME_ARTIFACT_MANIFEST_VERSION,
    manifestArtifactId: `artifact:manifest:${identity.slice(0, 24)}`,
    buildId: build.id,
    outputArtifactId: build.outputArtifactId,
    outputHash: build.outputHash,
    outputByteSize: build.outputByteSize,
    documentTextHash: build.documentTextHash,
    resumeVersionId: build.resumeVersionId,
    resumeContentHash: build.approvedContentHash,
    profileId: build.profileId,
    ...(build.jobId === undefined ? {} : { jobId: build.jobId }),
    changeSetId: changeSet.id,
    changeSetHash: changeSet.contentHash,
    baseContentHash: changeSet.baseContentHash,
    resultContentHash: changeSet.resultContentHash,
    factSnapshotHash: changeSet.factSnapshotHash,
    ...(changeSet.requirementSnapshotHash === undefined
      ? {}
      : { requirementSnapshotHash: changeSet.requirementSnapshotHash }),
    contentApprovalId: approval.id,
    contentApprovalHash,
    approvedPresentationHash: approval.approvedPresentationHash,
    templateId: build.templateId,
    templateVersion: build.templateVersion,
    templateHash: build.templateHash,
    builderName: build.builderName,
    builderVersion: build.builderVersion,
    verifierVersion: report.verifierVersion,
    buildReportHash,
    renderEvidenceHash: report.renderEvidenceHash,
    qualityGateEvidence,
    reproductionHash,
    createdAt: input.createdAt ?? build.builtAt,
  };
  return ResumeArtifactManifestSchema.parse({
    ...withoutHash,
    manifestHash: sha256(JSON.stringify(withoutHash)),
  });
}

/** Reconstruct the expected manifest and compare every field, including its own digest. */
export function verifyResumeArtifactManifest(input: CreateResumeArtifactManifestInput & {
  manifest: ResumeArtifactManifest;
}): boolean {
  try {
    const expected = createResumeArtifactManifest({
      build: input.build,
      report: input.report,
      approval: input.approval,
      changeSet: input.changeSet,
      createdAt: input.manifest.createdAt,
    });
    return JSON.stringify(expected) === JSON.stringify(input.manifest);
  } catch {
    return false;
  }
}

export function serializeResumeArtifactManifest(manifest: ResumeArtifactManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}
