import type { Fact, ResumeChangeSet, ResumeContentApproval, ResumeIR } from "@resume-agent/contracts";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CLASSIC_RESUME_TEMPLATE_ID,
  createResumeArtifactManifest,
  buildResumeDocument,
  serializeResumeArtifactManifest,
  verifyDocumentBuild,
  verifyResumeArtifactManifest,
} from "../src/index.js";
import { trustedRenderEvidence } from "./render-evidence.js";

const NOW = "2026-07-28T19:00:00-04:00";
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

const fact: Fact = {
  id: "fact:name",
  profileId: "profile:local",
  kind: "identity",
  key: "full_name",
  value: "Maya Chen",
  status: "verified",
  verification: { verifiedBy: "user", verifiedAt: NOW },
  sensitivity: "pii",
  sources: [{ artifactId: "artifact:source", locator: "line:1", excerpt: "Maya Chen" }],
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};
const resume: ResumeIR = {
  profileId: "profile:local",
  headerFactIds: [fact.id],
  summary: [],
  skills: [],
  experience: [],
  projects: [],
  education: [],
};
const contentHash = sha256(JSON.stringify(resume));
const changeSet: ResumeChangeSet = {
  id: "change-set:manifest",
  jobId: "job:manifest",
  baseResumeVersionId: "resume-version:base",
  baseContentHash: "1".repeat(64),
  resultContentHash: contentHash,
  factSnapshotHash: "2".repeat(64),
  requirementSnapshotHash: "3".repeat(64),
  changes: [],
  promptVersion: "test",
  model: "test",
  contentHash: "4".repeat(64),
  createdAt: NOW,
  updatedAt: NOW,
};
const approval: ResumeContentApproval = {
  id: "content-approval:manifest",
  resumeVersionId: "resume-version:manifest",
  profileId: "profile:local",
  jobId: changeSet.jobId,
  changeSetId: changeSet.id,
  changeSetHash: changeSet.contentHash,
  approvedContentHash: contentHash,
  approvedPresentationHash: sha256(JSON.stringify([CLASSIC_RESUME_TEMPLATE_ID, contentHash])),
  decidedBy: "user:local",
  decidedAt: NOW,
};

function fixture() {
  const document = buildResumeDocument({
    resumeVersionId: approval.resumeVersionId,
    profileId: approval.profileId,
    jobId: changeSet.jobId,
    templateId: CLASSIC_RESUME_TEMPLATE_ID,
    resume,
    facts: [fact],
    changeSet,
    approval,
    builtAt: NOW,
  });
  const report = verifyDocumentBuild({
    build: document.build,
    bytes: document.bytes,
    resume,
    facts: [fact],
    changeSet,
    approval,
    renderEvidence: trustedRenderEvidence(document.build, NOW),
    checkedAt: NOW,
  });
  return { ...document, report };
}

describe("resume artifact manifest", () => {
  it("records every immutable reconstruction and QA input", () => {
    const { build, report } = fixture();
    const manifest = createResumeArtifactManifest({ build, report, approval, changeSet });

    expect(manifest).toMatchObject({
      buildId: build.id,
      outputHash: build.outputHash,
      resumeContentHash: approval.approvedContentHash,
      changeSetHash: changeSet.contentHash,
      factSnapshotHash: changeSet.factSnapshotHash,
      requirementSnapshotHash: changeSet.requirementSnapshotHash,
      templateVersion: build.templateVersion,
      templateHash: build.templateHash,
      renderEvidenceHash: report.renderEvidenceHash,
    });
    expect(manifest.qualityGateEvidence).toHaveLength(5);
    expect(manifest.qualityGateEvidence.every((entry) => entry.status === "passed")).toBe(true);
  });

  it("is byte-for-byte reproducible for the same build inputs", () => {
    const { build, report } = fixture();
    const first = createResumeArtifactManifest({ build, report, approval, changeSet });
    const second = createResumeArtifactManifest({ build, report, approval, changeSet });

    expect(first).toEqual(second);
    expect(serializeResumeArtifactManifest(first)).toEqual(serializeResumeArtifactManifest(second));
  });

  it("detects a changed reconstruction hash or output binding", () => {
    const { build, report } = fixture();
    const manifest = createResumeArtifactManifest({ build, report, approval, changeSet });

    expect(
      verifyResumeArtifactManifest({
        manifest: { ...manifest, outputHash: "9".repeat(64) },
        build,
        report,
        approval,
        changeSet,
      }),
    ).toBe(false);
  });

  it("refuses manifests for legacy reports without delivery evidence", () => {
    const { build, report } = fixture();
    expect(() =>
      createResumeArtifactManifest({
        build,
        report: { ...report, qualityGates: undefined, renderEvidence: undefined, renderEvidenceHash: undefined },
        approval,
        changeSet,
      }),
    ).toThrow(/delivery gates/i);
  });

  it("refuses cross-change-set lineage substitution", () => {
    const { build, report } = fixture();
    expect(() =>
      createResumeArtifactManifest({
        build,
        report,
        approval,
        changeSet: { ...changeSet, id: "change-set:other" },
      }),
    ).toThrow(/same artifact lineage/i);
  });
});
