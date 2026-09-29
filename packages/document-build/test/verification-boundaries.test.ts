import type { Fact, ResumeChangeSet, ResumeContentApproval, ResumeIR } from "@resume-agent/contracts";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CLASSIC_RESUME_TEMPLATE_ID,
  buildResumeDocument,
  extractDocxText,
  readZip,
  verifyDocumentBuild,
  writeZip,
} from "../src/index.js";
import { trustedRenderEvidence } from "./render-evidence.js";

const NOW = "2026-07-28T04:00:00-04:00";
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

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
    sources: [{ artifactId: "artifact:resume", locator: "line:1", excerpt: value }],
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const facts: Fact[] = [
  fact("fact:name", "identity", "full_name", "Maya Chen"),
  fact("fact:email", "contact", "email", "maya@example.com"),
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

const approvedContentHash = sha256(JSON.stringify(resume));

const changeSet: ResumeChangeSet = {
  id: "change-set:one",
  jobId: "job:one",
  baseResumeVersionId: "resume-version:base",
  baseContentHash: "a".repeat(64),
  resultContentHash: sha256(JSON.stringify(resume)),
  factSnapshotHash: "b".repeat(64),
  changes: [],
  promptVersion: "no-prompt",
  model: "deterministic-selector",
  contentHash: "c".repeat(64),
  createdAt: NOW,
  updatedAt: NOW,
};

const approval: ResumeContentApproval = {
  id: "content-approval:one",
  resumeVersionId: "resume-version:one",
  profileId: "profile:local",
  jobId: changeSet.jobId,
  changeSetId: changeSet.id,
  changeSetHash: changeSet.contentHash,
  approvedContentHash,
  approvedPresentationHash: sha256(JSON.stringify([CLASSIC_RESUME_TEMPLATE_ID, approvedContentHash])),
  decidedBy: "user:local",
  decidedAt: NOW,
};

function build(change = changeSet, contentApproval = approval) {
  return buildResumeDocument({
    resumeVersionId: contentApproval.resumeVersionId,
    profileId: contentApproval.profileId,
    jobId: change.jobId,
    templateId: CLASSIC_RESUME_TEMPLATE_ID,
    resume,
    facts,
    changeSet: change,
    approval: contentApproval,
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
    renderEvidence: trustedRenderEvidence(result.build, NOW),
    checkedAt: NOW,
    ...overrides,
  });
}

describe("document verification boundaries", () => {
  it("binds the approval hash to the actual supplied resume", () => {
    const report = verify({ resume: { ...resume, skills: [] } });
    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.code === "approval_content_mismatch")).toBe(true);
  });

  it("requires cited verified facts to belong to the build profile", () => {
    const foreignFacts = facts.map((entry) => ({ ...entry, profileId: "profile:someone-else" }));
    const report = verify({ facts: foreignFacts });
    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.code === "block_not_fact_backed")).toBe(true);
  });

  it("gives identical bytes distinct build records when approvals differ", () => {
    const first = build();
    const otherChangeSet = { ...changeSet, id: "change-set:two", contentHash: "e".repeat(64) };
    const otherApproval = {
      ...approval,
      id: "content-approval:two",
      changeSetId: otherChangeSet.id,
      changeSetHash: otherChangeSet.contentHash,
    };
    const second = build(otherChangeSet, otherApproval);

    expect(first.build.outputHash).toBe(second.build.outputHash);
    expect(first.build.id).not.toBe(second.build.id);
  });

  it("detects extra text attached to an otherwise approved line", () => {
    const result = build();
    const entries = readZip(result.bytes);
    const documentXml = entries.get("word/document.xml");
    if (!documentXml) throw new Error("fixture produced no document XML");

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    entries.set(
      "word/document.xml",
      encoder.encode(decoder.decode(documentXml).replace(">Maya Chen<", ">UNAPPROVED Maya Chen<")),
    );
    const bytes = writeZip([...entries].map(([name, data]) => ({ name, data })));
    const documentText = extractDocxText(bytes);
    const tamperedBuild = {
      ...result.build,
      outputHash: sha256(bytes),
      outputByteSize: bytes.byteLength,
      documentTextHash: sha256(documentText),
    };

    const report = verifyDocumentBuild({
      build: tamperedBuild,
      bytes,
      resume,
      facts,
      changeSet,
      approval,
      checkedAt: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.code === "unapproved_text_in_document")).toBe(true);
  });
});
