import type { Fact, ResumeChangeSet, ResumeContentApproval, ResumeIR } from "@resume-agent/contracts";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildResumeDocument, buildResumeDocx, verifyDocumentBuild } from "../src/index.js";

const NOW = "2026-07-27T16:00:00-04:00";
const hash = (character: string) => character.repeat(64);

function fact(id: string, kind: Fact["kind"], key: string, value: string): Fact {
  return {
    id,
    profileId: "profile:local",
    kind,
    key,
    value,
    status: "verified",
    verification: { verifiedBy: "user", verifiedAt: NOW },
    sensitivity: "normal",
    sources: [{ artifactId: "artifact:resume1", locator: "line:1", excerpt: value }],
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const facts: Fact[] = [
  fact("fact:name", "identity", "full_name", "Maya Chen"),
  fact("fact:email", "contact", "email", "maya.chen@example.com"),
  fact("fact:skill", "skill", "skill.figma", "Figma"),
];

const resume: ResumeIR = {
  profileId: "profile:local",
  headerFactIds: ["fact:name", "fact:email"],
  summary: [],
  skills: [{ id: "item:figma", text: "Figma", factIds: ["fact:skill"], requirementIds: [] }],
  experience: [],
  projects: [],
  education: [],
};

const changeSet: ResumeChangeSet = {
  id: "change-set:1",
  jobId: "job:1",
  baseResumeVersionId: "resume-version:base",
  baseContentHash: hash("a"),
  resultContentHash: hash("b"),
  factSnapshotHash: hash("c"),
  changes: [],
  promptVersion: "no-prompt",
  model: "deterministic-selector",
  contentHash: hash("d"),
  createdAt: NOW,
  updatedAt: NOW,
};

/** The verifier checks that the approved hash really is this resume's, so the fixture must be self-consistent. */
const approvedContentHash = createHash("sha256").update(JSON.stringify(resume)).digest("hex");

const approval: ResumeContentApproval = {
  id: "content-approval:1",
  resumeVersionId: "resume-version:1",
  profileId: "profile:local",
  jobId: "job:1",
  changeSetId: "change-set:1",
  changeSetHash: hash("d"),
  approvedContentHash,
  approvedPresentationHash: hash("f"),
  decidedBy: "user:local",
  decidedAt: NOW,
};

function build() {
  return buildResumeDocument({
    resumeVersionId: "resume-version:1",
    profileId: "profile:local",
    jobId: "job:1",
    templateId: "template:default",
    resume,
    facts,
    changeSet,
    approval,
    builtAt: NOW,
  });
}

function verify(overrides: Partial<Parameters<typeof verifyDocumentBuild>[0]> = {}) {
  const result = build();
  return verifyDocumentBuild({
    build: result.build,
    bytes: result.bytes,
    resume,
    facts,
    changeSet,
    approval,
    checkedAt: NOW,
    ...overrides,
  });
}

describe("buildResumeDocument", () => {
  it("binds the document to the approval and change set it came from", () => {
    const { build: record, bytes } = build();

    expect(record.contentApprovalId).toBe(approval.id);
    expect(record.approvedContentHash).toBe(approval.approvedContentHash);
    expect(record.changeSetId).toBe(changeSet.id);
    expect(record.changeSetHash).toBe(changeSet.contentHash);
    expect(record.factSnapshotHash).toBe(changeSet.factSnapshotHash);
    expect(record.outputByteSize).toBe(bytes.byteLength);
    expect(record.outputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("records a block for every line it wrote", () => {
    const { build: record, text } = build();

    for (const block of record.blocks) {
      expect(text).toContain(block.text);
    }
  });
});

describe("verifyDocumentBuild", () => {
  it("passes a document that matches what was approved", () => {
    const report = verify();

    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("rejects bytes that changed after the build", () => {
    const other = buildResumeDocx({ ...resume, skills: [] }, facts);
    const report = verify({ bytes: other.bytes });

    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.code === "output_hash_mismatch")).toBe(true);
    expect(report.failures.some((failure) => failure.code === "document_text_mismatch")).toBe(true);
  });

  it("rejects a document built from different approved content", () => {
    const report = verify({ approval: { ...approval, approvedContentHash: hash("9") } });

    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.code === "approval_content_mismatch")).toBe(true);
  });

  it("rejects a document that cites another change set", () => {
    const report = verify({ changeSet: { ...changeSet, contentHash: hash("8") } });

    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.code === "change_set_mismatch")).toBe(true);
  });

  it("rejects a document whose block rests on a fact that is no longer verified", () => {
    const withdrawn = facts.map((entry) =>
      entry.id === "fact:skill"
        ? ({ ...entry, status: "rejected", rejection: { rejectedBy: "user:local", rejectedAt: NOW, reason: "Not current." } } as Fact)
        : entry,
    );
    const report = verify({ facts: withdrawn });

    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.code === "block_not_fact_backed")).toBe(true);
  });

  it("rejects a build record that claims a line the document does not contain", () => {
    const result = build();
    const firstBlock = result.build.blocks[0];
    if (!firstBlock) {
      throw new Error("fixture produced no blocks");
    }

    const report = verifyDocumentBuild({
      build: { ...result.build, blocks: [{ ...firstBlock, text: "Directed a department of two hundred." }] },
      bytes: result.bytes,
      resume,
      facts,
      changeSet,
      approval,
      checkedAt: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.code === "block_text_not_in_document")).toBe(true);
    expect(report.failures.some((failure) => failure.code === "unapproved_text_in_document")).toBe(true);
  });
});
