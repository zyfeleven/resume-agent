import type { Fact, ResumeDocumentBuild, ResumeIR } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import {
  auditDocumentPackage,
  buildResumeDocx,
  documentBuildReportPassesDownloadGate,
  readZip,
  verifyDocumentRenderEvidence,
  writeZip,
} from "../src/index.js";
import { trustedRenderEvidence } from "./render-evidence.js";

const NOW = "2026-07-28T12:00:00-04:00";

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

function fixture() {
  const document = buildResumeDocx(resume, [fact]);
  const build: ResumeDocumentBuild = {
    id: "document-build:quality",
    resumeVersionId: "resume-version:quality",
    profileId: "profile:local",
    changeSetId: "change-set:quality",
    changeSetHash: "1".repeat(64),
    factSnapshotHash: "2".repeat(64),
    contentApprovalId: "content-approval:quality",
    approvedContentHash: "3".repeat(64),
    templateId: document.templateId,
    templateVersion: document.templateVersion,
    templateHash: document.templateHash,
    builderName: "test",
    builderVersion: "1",
    outputArtifactId: "artifact:quality",
    outputHash: document.contentHash,
    outputByteSize: document.bytes.byteLength,
    documentTextHash: document.documentTextHash,
    blocks: document.blocks,
    builtAt: NOW,
  };
  return { document, build };
}

describe("document package quality gates", () => {
  it("passes the canonical package, privacy, and structural audits", () => {
    const { document } = fixture();
    const result = auditDocumentPackage(document.bytes);

    expect(result.failures).toEqual([]);
    expect(result.gates.map((entry) => [entry.kind, entry.status])).toEqual([
      ["package_safety", "passed"],
      ["privacy_metadata", "passed"],
      ["structure", "passed"],
    ]);
  });

  it("rejects metadata residue even when the visible text is unchanged", () => {
    const { document } = fixture();
    const entries = readZip(document.bytes);
    entries.set("docProps/core.xml", new TextEncoder().encode("<cp:coreProperties><dc:creator>Alice</dc:creator></cp:coreProperties>"));
    const result = auditDocumentPackage(writeZip([...entries].map(([name, data]) => ({ name, data }))));

    expect(result.failures.some((entry) => entry.code === "privacy_metadata_failed")).toBe(true);
    expect(result.gates.find((entry) => entry.kind === "privacy_metadata")?.status).toBe("failed");
  });

  it("rejects external relationships and active-package residue", () => {
    const { document } = fixture();
    const entries = readZip(document.bytes);
    entries.set(
      "_rels/.rels",
      new TextEncoder().encode(
        '<Relationships><Relationship Id="evil" Target="https://example.invalid" TargetMode="External"/></Relationships>',
      ),
    );
    const result = auditDocumentPackage(writeZip([...entries].map(([name, data]) => ({ name, data }))));

    expect(result.failures.some((entry) => entry.code === "package_safety_failed")).toBe(true);
  });

  it("rejects missing template structure", () => {
    const { document } = fixture();
    const entries = [...readZip(document.bytes)].filter(([name]) => name !== "word/numbering.xml");
    const result = auditDocumentPackage(writeZip(entries.map(([name, data]) => ({ name, data }))));

    expect(result.failures.some((entry) => entry.code === "structure_failed")).toBe(true);
  });

  it("rejects ZIP bytes whose entry checksum was not updated", () => {
    const { document } = fixture();
    const tampered = Uint8Array.from(document.bytes);
    tampered[50] = (tampered[50] ?? 0) ^ 0xff;

    const result = auditDocumentPackage(tampered);
    expect(result.failures.some((entry) => entry.code === "package_safety_failed")).toBe(true);
  });
});

describe("render and visual gates", () => {
  it("blocks both gates when trusted render evidence is absent", () => {
    const { document, build } = fixture();
    const result = verifyDocumentRenderEvidence(build, document.bytes, undefined);

    expect(result.gates.map((entry) => entry.status)).toEqual(["blocked", "blocked"]);
    expect(result.failures[0]?.code).toBe("render_evidence_missing");
  });

  it("passes hash-bound evidence with one inspection for every page", () => {
    const { document, build } = fixture();
    const evidence = trustedRenderEvidence(build, NOW);
    const result = verifyDocumentRenderEvidence(build, document.bytes, evidence);

    expect(result.failures).toEqual([]);
    expect(result.gates.map((entry) => entry.status)).toEqual(["passed", "passed"]);
  });

  it("rejects evidence replayed onto different bytes", () => {
    const { document, build } = fixture();
    const evidence = { ...trustedRenderEvidence(build, NOW), outputHash: "9".repeat(64) };
    const result = verifyDocumentRenderEvidence(build, document.bytes, evidence);

    expect(result.failures[0]?.code).toBe("render_evidence_mismatch");
  });

  it("rejects a visually defective rendered page", () => {
    const { document, build } = fixture();
    const base = trustedRenderEvidence(build, NOW);
    const evidence = trustedRenderEvidence(build, NOW, {
      pages: [{ ...(base.pages[0] as (typeof base.pages)[number]), clipping: true }],
    });
    const result = verifyDocumentRenderEvidence(build, document.bytes, evidence);

    expect(result.failures[0]?.code).toBe("visual_quality_failed");
    expect(result.gates.find((entry) => entry.kind === "visual_regression")?.status).toBe("failed");
  });

  it("does not grandfather a pre-P2-06 report into the download gate", () => {
    expect(documentBuildReportPassesDownloadGate({ passed: true, failures: [] })).toBe(false);
  });
});
