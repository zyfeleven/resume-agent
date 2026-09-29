import type { Fact, ResumeDocumentBuild, ResumeIR } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import {
  buildResumeDocx,
  inspectRenderedResume,
  localDocumentRendererAvailable,
  readPngDimensions,
  renderResumeDocumentEvidence,
  verifyDocumentRenderEvidence,
} from "../src/index.js";

const NOW = "2026-07-28T12:00:00-04:00";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("local render inspection", () => {
  it("reads exact PNG dimensions from the IHDR chunk", () => {
    expect(readPngDimensions(pngHeader(1275, 1650))).toEqual({ widthPixels: 1275, heightPixels: 1650 });
    expect(() => readPngDimensions(new Uint8Array(24))).toThrow(/valid PNG/i);
  });

  it("passes complete Arial page geometry and expected text", () => {
    const result = inspectRenderedResume({
      bboxHtml:
        '<page width="612" height="792"><word xMin="50" yMin="50" xMax="80" yMax="60">Maya</word><word xMin="85" yMin="50" xMax="110" yMax="60">Chen</word></page>',
      layoutText: "Maya Chen",
      fontReport: "name type encoding emb sub uni object ID\n------------------------------------\nAAAAAA+ArialMT TrueType WinAnsi yes yes yes 1 0",
      expectedLines: ["Maya Chen"],
      expectedBulletCount: 0,
    });

    expect(result).toEqual([
      {
        clipping: false,
        overlap: false,
        missingGlyph: false,
        fontFallback: false,
        bulletMisalignment: false,
        unexpectedPageBreak: false,
        unexpectedBlankPage: false,
      },
    ]);
  });

  it("fails closed for missing text, fallback fonts, overlap, and edge clipping", () => {
    const result = inspectRenderedResume({
      bboxHtml:
        '<page width="612" height="792"><word xMin="0" yMin="50" xMax="80" yMax="65">Maya</word><word xMin="40" yMin="52" xMax="95" yMax="66">Other</word></page>',
      layoutText: "Maya Other",
      fontReport: "name type encoding emb sub uni object ID\n------------------------------------\nAAAAAA+LiberationSans TrueType WinAnsi yes yes yes 1 0",
      expectedLines: ["Maya Chen"],
      expectedBulletCount: 0,
    });

    expect(result[0]).toMatchObject({ clipping: true, overlap: true, missingGlyph: true, fontFallback: true });
  });
});

const rendererIt = localDocumentRendererAvailable() ? it : it.skip;

rendererIt("creates verifiable evidence from a real LibreOffice-rendered DOCX", () => {
  const fact = (id: string, kind: Fact["kind"], key: string, value: string): Fact => ({
    id,
    profileId: "profile:render",
    kind,
    key,
    value,
    status: "verified",
    verification: { verifiedBy: "user", verifiedAt: NOW },
    sensitivity: kind === "identity" ? "pii" : "normal",
    sources: [{ artifactId: "artifact:source", locator: id, excerpt: value }],
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const facts = [
    fact("fact:render-name", "identity", "full_name", "Maya Chen"),
    fact("fact:render-role", "employment", "role", "Product Designer"),
    fact("fact:render-org", "employment", "organization", "Northstar Labs"),
    fact("fact:render-date", "employment", "dates", "2022 - Present"),
    fact("fact:render-achievement", "achievement", "achievement", "Built an accessible design system used by six teams."),
  ];
  const resume: ResumeIR = {
    profileId: "profile:render",
    headerFactIds: ["fact:render-name"],
    summary: [],
    skills: [],
    experience: [
      {
        id: "experience:render",
        roleFactId: "fact:render-role",
        organizationFactId: "fact:render-org",
        dateFactIds: ["fact:render-date"],
        bullets: [
          {
            id: "item:render-achievement",
            text: "Built an accessible design system used by six teams.",
            factIds: ["fact:render-achievement"],
            requirementIds: [],
          },
        ],
      },
    ],
    projects: [],
    education: [],
  };
  const document = buildResumeDocx(resume, facts);
  const build: ResumeDocumentBuild = {
    id: "document-build:local-render",
    resumeVersionId: "resume-version:local-render",
    profileId: resume.profileId,
    changeSetId: "change-set:local-render",
    changeSetHash: "1".repeat(64),
    factSnapshotHash: "2".repeat(64),
    contentApprovalId: "content-approval:local-render",
    approvedContentHash: "3".repeat(64),
    templateId: document.templateId,
    templateVersion: document.templateVersion,
    templateHash: document.templateHash,
    builderName: "test",
    builderVersion: "1",
    outputArtifactId: "artifact:local-render",
    outputHash: document.contentHash,
    outputByteSize: document.bytes.byteLength,
    documentTextHash: document.documentTextHash,
    blocks: document.blocks,
    builtAt: NOW,
  };

  const evidence = renderResumeDocumentEvidence({ build, bytes: document.bytes, renderedAt: NOW });
  expect(evidence.rendererName).toBe("libreoffice-poppler-local-inspector");
  expect(evidence.pages).toHaveLength(1);
  expect(verifyDocumentRenderEvidence(build, document.bytes, evidence).failures).toEqual([]);
}, 90_000);
