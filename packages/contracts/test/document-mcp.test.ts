import { describe, expect, it } from "vitest";

import {
  ArtifactExportInputSchema,
  DocxParseInputSchema,
  DocumentMcpToolDescriptorSchema,
  DocumentTrustedAuthorizationRecordSchema,
  documentMcpToolCatalog,
} from "../src/document-mcp.js";
import {
  computeDocumentCanonicalHash,
  computeDocumentActionFingerprint,
  validateDocumentReadRequest,
  validateDocumentReadResult,
  validateDocumentWriteRequest,
  validateDocumentWriteResult,
  type DocumentValidationContext,
} from "../src/document-mcp-validation.js";
import {
  buildDocumentMcpWireTools,
  createValidatedDocumentMcpWriteHandler,
  parseDocumentMcpStructuredContent,
} from "../src/document-mcp-wire.js";

const now = "2026-07-27T01:00:00-04:00";
const beforeNow = "2026-07-27T00:59:00-04:00";
const later = "2026-07-27T01:10:00-04:00";
const muchLater = "2026-07-27T02:00:00-04:00";
const nonce = "n".repeat(32);
const oldTextHash =
  "6851ce0ed681a1bfc584cdb2e337eee5c5f3c975d83e813641e859630146a594";
const newTextHash =
  "b58089cc1386865a0900f642c927f37fe2f31aa76fc8e3b3a275a36e5cd9f144";
const headerTextHash =
  "f36fada5f1d613cb1ef162b65c11bcf6b9fceeeee852974468b07c2fb12cbb34";
const oldSemanticTextHash =
  "f6e666210bf7c6c651102c021ca6103605b80f51c88b8e054e25e5bf2564933f";
const newSemanticTextHash =
  "2aed9f6acb30ad31df3d89cc06cda5ca747e36aaab9d19ba3c4f32a301c10d9b";
const skillsTextHash =
  "66d0f523a379b2de6f8d5fba3a817ebc395f7bcaa54cc132ca9dfa665d1e9378";
const templateSemanticTextHash =
  "aeb08dc39488c189a4358e7353f875901d40f5c4497d52a468712a1ec65c6f6a";
const swappedSlotSemanticTextHash =
  "bad074812a86086d0f3fd00052d94320a46b2d7dc237798812a61aeed15ea888";
const extraDynamicBlockSemanticTextHash =
  "59f5ac77680959bf90cd94a8ef3f350c3a6262c5d6b72b113329a2fde2154150";

function hash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && value) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Fixture is not canonical JSON.");
}

function docx(
  artifactId: string,
  kind:
    | "source_resume"
    | "tailored_resume"
    | "privacy_scrubbed_document"
    | "other",
  contentHash: string,
  fileName = `${artifactId.replace(":", "-")}.docx`,
) {
  return {
    artifactId,
    kind,
    fileName,
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
    contentHash,
    byteSize: 1_024,
  };
}

function json<
  const TKind extends
    | "document_ir"
    | "document_inspection"
    | "document_manifest"
    | "document_qa_report"
    | "document_diff"
    | "privacy_report"
    | "manifest"
    | "other",
>(
  artifactId: string,
  kind: TKind,
  contentHash: string,
) {
  return {
    artifactId,
    kind,
    fileName: `${artifactId.replace(":", "-")}.json`,
    mediaType: "application/json" as const,
    contentHash,
    byteSize: 512,
  };
}

function png(artifactId: string, contentHash: string) {
  return {
    artifactId,
    kind: "document_render_page" as const,
    fileName: `${artifactId.replace(":", "-")}.png`,
    mediaType: "image/png" as const,
    contentHash,
    byteSize: 2_048,
  };
}

function trustedArtifact<T extends { contentHash: string }>(
  artifact: T,
  actualByteHash = artifact.contentHash,
  provenance?: { creatingOperationId: string; resumeVersionId: string },
) {
  return {
    ...artifact,
    ownerProfileId: "profile:1",
    ...(provenance ?? {}),
    actualByteHash,
    status: "available" as const,
    verifiedAt: beforeNow,
  };
}

function securityInspection() {
  return {
    status: "clean" as const,
    detectedFormat: "docx_ooxml" as const,
    packageMetrics: {
      compressedBytes: 1_024,
      expandedBytes: 4_096,
      largestEntryBytes: 1_024,
      entryCount: 12,
      maximumCompressionRatio: 4,
    },
    normalizedEntryNamesUnique: true as const,
    crcAndSizesVerified: true as const,
    hasMacros: false as const,
    hasEncryptedPackage: false as const,
    hasActiveX: false as const,
    hasOleOrEmbeddedPackages: false as const,
    hasAltChunk: false as const,
    externalRelationshipCount: 0 as const,
    unsafeFieldCodeCount: 0 as const,
    unsafePackagePathCount: 0 as const,
    networkAccessAttempted: false as const,
    findings: [],
    inspectedAt: beforeNow,
    inspectionHash: hash(40),
  };
}

const sourceDocument = docx("artifact:source", "source_resume", hash(1), "resume.docx");
const templateDocument = docx("artifact:template", "other", hash(2), "template.docx");
const builtDocument = docx("artifact:built", "tailored_resume", hash(3), "tailored.docx");
// A scrub may create a new immutable artifact even when there was no metadata to remove.
const scrubbedDocument = docx(
  "artifact:scrubbed",
  "privacy_scrubbed_document",
  hash(3),
  "tailored-clean.docx",
);
const sourceSnapshotArtifact = json("artifact:snapshot-source", "document_ir", hash(10));
const outputSnapshotArtifact = json("artifact:snapshot-output", "document_ir", hash(11));
const scrubbedSnapshotArtifact = json("artifact:snapshot-scrubbed", "document_ir", hash(77));
const templateSnapshotArtifact = json("artifact:snapshot-template", "document_ir", hash(79));
const templateProfileArtifact = json("artifact:template-profile", "document_inspection", hash(12));
const buildManifestArtifact = json("artifact:build-manifest", "document_manifest", hash(13));
const presentationPlanArtifact = json(
  "artifact:presentation-plan",
  "document_ir",
  "24bebb9a4f5e63e6a11ec2eeba3ea092740dcdd95759e081b328235541ad0f8d",
);
const textDiffArtifact = json("artifact:text-diff", "document_diff", hash(14));
const renderManifestArtifact = json("artifact:render-manifest", "document_manifest", hash(15));
const visualDiffArtifact = json("artifact:visual-diff", "document_diff", hash(16));
const privacyReportArtifact = json("artifact:privacy-report", "privacy_report", hash(17));
const qaReportArtifact = json("artifact:qa-report", "document_qa_report", hash(18));
const exportManifestArtifact = json("artifact:export-manifest", "document_manifest", hash(19));
const pageOne = png("artifact:page-1", hash(20));
const pageTwo = png("artifact:page-2", hash(21));
const basePageOne = png("artifact:base-page-1", hash(22));
const basePageTwo = png("artifact:base-page-2", hash(23));
const diffPageOne = { ...png("artifact:diff-page-1", hash(24)), kind: "document_render" as const };
const diffPageTwo = { ...png("artifact:diff-page-2", hash(25)), kind: "document_render" as const };
const qaEvidenceArtifacts = Array.from({ length: 14 }, (_, index) =>
  json(`artifact:qa-evidence-${index + 1}`, "other", hash(100 + index)),
);

const presentationPlanHash = presentationPlanArtifact.contentHash;
const presentationPlanItems = [
  {
    presentationItemId: "presentation:header",
    slotId: "slot:header",
    ordinalInSlot: 0,
    source: {
      kind: "facts" as const,
      presentationKind: "header" as const,
      factIds: ["fact:name"],
    },
    text: "Yifan Zhu",
    textHash: headerTextHash,
  },
  {
    presentationItemId: "presentation:summary",
    slotId: "slot:summary",
    ordinalInSlot: 0,
    source: { kind: "content_item" as const, contentItemId: "item:summary" },
    text: "Built reliable distributed systems.",
    textHash: newTextHash,
  },
];

const packageLimits = {
  maxCompressedBytes: 25 * 1024 * 1024,
  maxExpandedBytes: 200 * 1024 * 1024,
  maxEntryBytes: 50 * 1024 * 1024,
  maxEntries: 5_000,
  maxCompressionRatio: 100,
  maxNestedArchiveDepth: 0 as const,
  timeoutMs: 120_000,
};

const baseResume = {
  profileId: "profile:1",
  headerFactIds: ["fact:name"],
  summary: [
    {
      id: "item:summary",
      text: "Built reliable systems.",
      factIds: ["fact:achievement"],
      requirementIds: [],
    },
  ],
  skills: [],
  experience: [],
  projects: [],
  education: [],
};

const resultResume = {
  ...baseResume,
  summary: [
    {
      ...baseResume.summary[0]!,
      text: "Built reliable distributed systems.",
      requirementIds: ["requirement:distributed"],
    },
  ],
};

const changeSet = {
  id: "changeset:1",
  jobId: "job:1",
  baseResumeVersionId: "resume:1",
  baseContentHash: hash(1),
  resultContentHash: hash(3),
  factSnapshotHash: hash(30),
  requirementSnapshotHash: hash(31),
  changes: [
    {
      id: "change:1",
      targetItemId: "item:summary",
      factIds: ["fact:achievement"],
      requirementIds: ["requirement:distributed"],
      rationale: "Match the verified experience to the role.",
      intent: "rewrite" as const,
      before: "Built reliable systems.",
      after: "Built reliable distributed systems.",
    },
  ],
  promptVersion: "resume-tailor-v1",
  model: "test-model",
  contentHash: hash(32),
  createdAt: beforeNow,
  updatedAt: beforeNow,
};

const review = {
  id: "review:1",
  changeSetId: "changeset:1",
  changeId: "change:1",
  reviewedChangeHash: hash(33),
  decision: "approved" as const,
  decidedBy: "user:1",
  decidedAt: beforeNow,
};

const contentApproval = {
  id: "content-approval:1",
  resumeVersionId: "resume:1",
  profileId: "profile:1",
  jobId: "job:1",
  changeSetId: "changeset:1",
  changeSetHash: hash(32),
  approvedContentHash: hash(3),
  approvedPresentationHash: presentationPlanHash,
  decidedBy: "user:1",
  decidedAt: beforeNow,
};

const factSnapshot = {
  profileId: "profile:1",
  facts: [
    { factId: "fact:name", version: 1 },
    { factId: "fact:achievement", version: 1 },
  ],
  snapshotHash: hash(30),
};

const requirementSnapshot = {
  jobId: "job:1",
  descriptionHash: hash(34),
  requirementIds: ["requirement:distributed"],
  snapshotHash: hash(31),
};

function snapshot(
  snapshotId: string,
  artifact:
    | typeof sourceDocument
    | typeof templateDocument
    | typeof builtDocument
    | typeof scrubbedDocument,
  snapshotArtifact:
    | typeof sourceSnapshotArtifact
    | typeof outputSnapshotArtifact
    | typeof scrubbedSnapshotArtifact
    | typeof templateSnapshotArtifact,
  snapshotHash: string,
  semanticTextHash: string,
) {
  return {
    snapshotId,
    sourceArtifact: artifact,
    parserName: "safe-ooxml-parser",
    parserVersion: "1.0.0",
    parserProfileHash: hash(70),
    packageLimits,
    semanticTextHash,
    packagePartSetHash: hash(41),
    documentModelHash: hash(42),
    blocks: [
      {
        id: "block:header",
        ordinal: 0,
        story: "body" as const,
        kind: "paragraph" as const,
        text: "Yifan Zhu",
        textHash: headerTextHash,
        styleId: "Header",
        sensitivity: "normal" as const,
      },
      {
        id: "block:summary",
        ordinal: 1,
        story: "body" as const,
        kind: "paragraph" as const,
        text:
          artifact.artifactId === sourceDocument.artifactId ||
          artifact.artifactId === templateDocument.artifactId
            ? "Built reliable systems."
            : "Built reliable distributed systems.",
        textHash:
          artifact.artifactId === sourceDocument.artifactId ||
          artifact.artifactId === templateDocument.artifactId
            ? oldTextHash
            : newTextHash,
        styleId: "Summary",
        sensitivity: "normal" as const,
      },
    ],
    sectionCount: 1,
    hasComments: false,
    hasTrackedChanges: false,
    hasHiddenText: false,
    hasCustomProperties: false,
    securityInspection: securityInspection(),
    snapshotArtifact,
    createdAt: beforeNow,
    snapshotHash,
  };
}

const sourceSnapshot = snapshot(
  "snapshot:source",
  sourceDocument,
  sourceSnapshotArtifact,
  hash(45),
  oldSemanticTextHash,
);
const templateSnapshot = snapshot(
  "snapshot:template",
  templateDocument,
  templateSnapshotArtifact,
  hash(49),
  templateSemanticTextHash,
);
templateSnapshot.blocks.push({
  id: "block:skills",
  ordinal: 2,
  story: "body",
  kind: "paragraph",
  text: "Skills",
  textHash: skillsTextHash,
  styleId: "Skills",
  sensitivity: "normal",
});
const outputSnapshot = snapshot(
  "snapshot:output",
  builtDocument,
  outputSnapshotArtifact,
  hash(47),
  newSemanticTextHash,
);
const scrubbedSnapshot = snapshot(
  "snapshot:scrubbed",
  scrubbedDocument,
  scrubbedSnapshotArtifact,
  hash(78),
  newSemanticTextHash,
);

const templateProfile = {
  templateId: "template:1",
  templateVersion: "1.0.0",
  templateArtifact: templateDocument,
  sourceSnapshotHash: hash(49),
  inspectorName: "safe-template-inspector",
  inspectorVersion: "1.0.0",
  staticBlockIds: [],
  slots: [
    {
      slotId: "slot:header",
      kind: "header" as const,
      targetBlockIds: ["block:header"],
      styleId: "Header",
      maxCharacters: 1_000,
      maxItems: 10,
    },
    {
      slotId: "slot:summary",
      kind: "summary" as const,
      targetBlockIds: ["block:summary"],
      styleId: "Summary",
      maxCharacters: 1_000,
      maxItems: 10,
    },
    {
      slotId: "slot:skills",
      kind: "skills" as const,
      targetBlockIds: ["block:skills"],
      styleId: "Skills",
      maxCharacters: 1_000,
      maxItems: 20,
    },
  ],
  immutablePartHashes: { "word/styles.xml": hash(50) },
  pageWidthDxa: 12_240,
  pageHeightDxa: 15_840,
  marginTopDxa: 720,
  marginRightDxa: 720,
  marginBottomDxa: 720,
  marginLeftDxa: 720,
  requiredFontNames: ["Arial"],
  inspectionProfileHash: hash(76),
  packageLimits,
  profileArtifact: templateProfileArtifact,
  inspectedAt: beforeNow,
  profileHash: hash(51),
};

const buildManifest = {
  manifestId: "build-manifest:1",
  operationId: "operation:apply",
  resumeVersionId: "resume:1",
  profileId: "profile:1",
  jobId: "job:1",
  sourceContentHash: hash(1),
  resultContentHash: hash(3),
  changeSetId: "changeset:1",
  changeSetHash: hash(32),
  factSnapshotHash: hash(30),
  requirementSnapshotHash: hash(31),
  contentApprovalId: "content-approval:1",
  contentApprovalHash:
    "259ce2ef96c8cfea30705c84324280e037f9dc1c3eba81258d1c563b81f14b93",
  templateId: "template:1",
  templateVersion: "1.0.0",
  templateHash: hash(2),
  templateProfileHash: hash(51),
  sourceDocument,
  outputDocument: builtDocument,
  sourceSnapshotHash: hash(45),
  outputSnapshotHash: hash(47),
  operations: [
    {
      id: "operation:block-1",
      changeId: "change:1",
      contentItemId: "item:summary",
      kind: "replace_block" as const,
      targetBlockId: "block:summary",
      expectedTextHash: oldTextHash,
      replacementTextHash: newTextHash,
    },
  ],
  presentationPlanHash,
  presentationPlanArtifact,
  presentationBindings: [
    {
      presentationItemId: "presentation:header",
      outputBlockId: "block:header",
      outputTextHash: headerTextHash,
    },
    {
      presentationItemId: "presentation:summary",
      outputBlockId: "block:summary",
      outputTextHash: newTextHash,
    },
  ],
  claimProvenance: [
    {
      contentItemId: "item:summary",
      outputBlockId: "block:summary",
      outputTextHash: newTextHash,
      resumeChangeId: "change:1",
      factBindings: [
        {
          factId: "fact:achievement",
          factVersion: 1,
          factHash: hash(53),
          status: "verified" as const,
          sourceArtifactIds: ["artifact:source"],
        },
      ],
      requirementIds: ["requirement:distributed"],
      reviewDecisionIds: ["review:1"],
    },
  ],
  presentation: "clean" as const,
  builderName: "deterministic-docx-builder",
  builderVersion: "1.0.0",
  runtimeHash: hash(54),
  configurationHash: hash(55),
  preservedPackagePartSetHash: hash(56),
  manifestArtifact: buildManifestArtifact,
  createdAt: beforeNow,
  manifestHash: hash(57),
};

const textDiffReport = {
  reportId: "text-diff:1",
  baseDocument: sourceDocument,
  candidateDocument: scrubbedDocument,
  baseSemanticTextHash: oldSemanticTextHash,
  candidateSemanticTextHash: newSemanticTextHash,
  changeSetId: "changeset:1",
  changeSetHash: hash(32),
  buildManifestHash: hash(57),
  differName: "resume-semantic-differ",
  differVersion: "1.0.0",
  runtimeHash: hash(121),
  configurationHash: hash(122),
  hunks: [
    {
      id: "hunk:1",
      changeId: "change:1",
      story: "body" as const,
      blockId: "block:summary",
      kind: "replace" as const,
      beforeTextHash: oldTextHash,
      afterTextHash: newTextHash,
      approved: true,
    },
  ],
  expectedChangeIds: ["change:1"],
  unexpectedHunkCount: 0,
  hiddenContentChangeCount: 0,
  relationshipChangeCount: 0,
  reportArtifact: textDiffArtifact,
  createdAt: beforeNow,
  reportHash: hash(58),
};

function renderManifest(
  manifestId: string,
  source: typeof sourceDocument | typeof scrubbedDocument,
  manifestArtifact: typeof renderManifestArtifact | typeof baseRenderArtifact,
  pages: Array<{ pageNumber: number; artifact: ReturnType<typeof png> }>,
  renderSetHash: string,
) {
  return {
    manifestId,
    sourceDocument: source,
    rendererName: "libreoffice-headless",
    rendererVersion: "26.2",
    runtimeHash: hash(59),
    configurationHash: hash(60),
    fontPackHash: hash(61),
    revisionView: "clean" as const,
    pageCount: pages.length,
    pages: pages.map(({ pageNumber, artifact }) => ({
      pageNumber,
      artifact,
      widthPixels: 1_275,
      heightPixels: 1_650,
      dpi: 150,
    })),
    qaStatus: "pending" as const,
    manifestArtifact,
    renderedAt: beforeNow,
    renderSetHash,
  };
}

const candidateRender = renderManifest(
  "render:candidate",
  scrubbedDocument,
  renderManifestArtifact,
  [
    { pageNumber: 1, artifact: pageOne },
    { pageNumber: 2, artifact: pageTwo },
  ],
  hash(62),
);
const baseRenderArtifact = json("artifact:base-render-manifest", "document_manifest", hash(63));
const baseRender = renderManifest(
  "render:base",
  sourceDocument,
  baseRenderArtifact,
  [
    { pageNumber: 1, artifact: basePageOne },
    { pageNumber: 2, artifact: basePageTwo },
  ],
  hash(64),
);

const visualDiffReport = {
  reportId: "visual-diff:1",
  baseRenderSetHash: hash(64),
  candidateRenderSetHash: hash(62),
  comparatorName: "pixelmatch",
  comparatorVersion: "1.0.0",
  runtimeHash: hash(130),
  configurationHash: hash(65),
  pages: [
    {
      pageNumber: 1,
      basePage: basePageOne,
      candidatePage: pageOne,
      diffImage: diffPageOne,
      changedPixelRatio: 0.02,
      dimensionsMatch: true,
    },
    {
      pageNumber: 2,
      basePage: basePageTwo,
      candidatePage: pageTwo,
      diffImage: diffPageTwo,
      changedPixelRatio: 0,
      dimensionsMatch: true,
    },
  ],
  addedPageCount: 0,
  removedPageCount: 0,
  reportArtifact: visualDiffArtifact,
  createdAt: beforeNow,
  reportHash: hash(66),
};

const noResidue = {
  coreProperties: 0,
  appProperties: 0,
  customProperties: 0,
  commentAuthors: 0,
  comments: 0,
  trackedDeletions: 0,
  revisionAuthors: 0,
  hiddenTextRuns: 0,
  documentVariables: 0,
  customXmlParts: 0,
  thumbnails: 0,
  imageMetadataRecords: 0,
  externalRelationships: 0,
  embeddedPackages: 0,
};

const privacyReport = {
  reportId: "privacy-report:1",
  sourceDocument: builtDocument,
  outputDocument: scrubbedDocument,
  policyVersion: "privacy-v1",
  policyHash: hash(67),
  scrubberName: "trusted-privacy-scrubber",
  scrubberVersion: "1.0.0",
  runtimeHash: hash(119),
  configurationHash: hash(120),
  visibleContentPolicy: "preserve_exactly" as const,
  sourceSnapshotHash: hash(47),
  outputSnapshotHash: hash(78),
  semanticTextHashBefore: newSemanticTextHash,
  semanticTextHashAfter: newSemanticTextHash,
  removed: { ...noResidue },
  remaining: { ...noResidue },
  packageSecurityRevalidated: true as const,
  securityInspection: securityInspection(),
  reportArtifact: privacyReportArtifact,
  createdAt: beforeNow,
  reportHash: hash(68),
};

const qaCheckKinds = [
  "package_security",
  "ooxml_integrity",
  "approved_text_diff",
  "ats_text_order",
  "structure",
  "styles_numbering",
  "links",
  "privacy_metadata",
  "accessibility",
  "render_complete",
  "visual_page_review",
  "claim_provenance",
] as const;

const qaReport = {
  reportId: "qa-report:1",
  resumeVersionId: "resume:1",
  profileId: "profile:1",
  candidateDocument: scrubbedDocument,
  buildManifestHash: hash(57),
  textDiffReportHash: hash(58),
  renderSetHash: hash(62),
  visualDiffReportHash: hash(66),
  privacyReportHash: hash(68),
  auditorName: "trusted-document-auditor",
  auditorVersion: "1.0.0",
  runtimeHash: hash(114),
  configurationHash: hash(115),
  requiredCheckKinds: [...qaCheckKinds],
  checks: qaCheckKinds.map((kind, index) => ({
    kind,
    status: "passed" as const,
    evidenceArtifactIds: [qaEvidenceArtifacts[index]!.artifactId],
    findingIds: [],
  })),
  pageInspections: [pageOne, pageTwo].map((page, index) => ({
    pageNumber: index + 1,
    pageArtifact: page,
    inspectorType: "agent" as const,
    inspectorId: "agent:qa",
    inspectedAt: beforeNow,
    zoomPercent: 100 as const,
    clipping: false as const,
    overlap: false as const,
    missingGlyph: false as const,
    fontFallback: false as const,
    tableOverflow: false as const,
    bulletMisalignment: false as const,
    headerFooterCollision: false as const,
    unexpectedPageBreak: false as const,
    orphanHeading: false as const,
    unexpectedBlankPage: false as const,
    status: "passed" as const,
    evidenceArtifactIds: [qaEvidenceArtifacts[12 + index]!.artifactId],
  })),
  findings: [],
  overallStatus: "passed" as const,
  reportArtifact: qaReportArtifact,
  completedAt: beforeNow,
  reportHash: hash(69),
};

const qaEvidenceKinds = [
  "package_security_inspection",
  "ooxml_integrity_scan",
  "approved_text_diff",
  "ats_order_scan",
  "structure_scan",
  "styles_numbering_scan",
  "link_scan",
  "privacy_scan",
  "accessibility_scan",
  "render_manifest",
  "page_visual_inspection",
  "claim_provenance_audit",
] as const;

const qaEvidenceRecords = [
  ...qaCheckKinds.map((checkKind, index) => ({
    artifactId: qaEvidenceArtifacts[index]!.artifactId,
    contentHash: qaEvidenceArtifacts[index]!.contentHash,
    resumeVersionId: "resume:1",
    profileId: "profile:1",
    candidateArtifactId: scrubbedDocument.artifactId,
    candidateArtifactHash: scrubbedDocument.contentHash,
    checkKind,
    evidenceKind: qaEvidenceKinds[index]!,
    verifiedAt: beforeNow,
  })),
  ...[1, 2].map((pageNumber, index) => ({
    artifactId: qaEvidenceArtifacts[12 + index]!.artifactId,
    contentHash: qaEvidenceArtifacts[12 + index]!.contentHash,
    resumeVersionId: "resume:1",
    profileId: "profile:1",
    candidateArtifactId: scrubbedDocument.artifactId,
    candidateArtifactHash: scrubbedDocument.contentHash,
    checkKind: "visual_page_review" as const,
    pageNumber,
    evidenceKind: "page_visual_inspection" as const,
    verifiedAt: beforeNow,
  })),
];

function resumeRecord(status: "user_approved" | "docx_built" | "qa_passed") {
  const artifact = status === "user_approved" ? sourceDocument : status === "docx_built" ? builtDocument : scrubbedDocument;
  return {
    version: {
      id: "resume:1",
      profileId: "profile:1",
      jobId: "job:1",
      parentVersionId: "resume:base",
      templateId: "template:1",
      resume: status === "user_approved" ? baseResume : resultResume,
      changeSetId: "changeset:1",
      status,
      contentHash: status === "user_approved" ? hash(1) : hash(3),
      createdAt: beforeNow,
      updatedAt: beforeNow,
    },
    revision: 7,
    documentArtifactId: artifact.artifactId,
    documentArtifactHash: artifact.contentHash,
  };
}

function emptyContext(): DocumentValidationContext {
  return {
    authenticatedProfileId: "profile:1",
    now,
    artifactRecords: [],
    snapshots: [],
    templateProfiles: [],
    buildManifests: [],
    textDiffReports: [],
    renderManifests: [],
    visualDiffReports: [],
    privacyReports: [],
    qaReports: [],
    exportManifests: [],
    reviews: [],
    facts: [],
    requirements: [],
    inspectors: [
      {
        inspectorType: "agent",
        inspectorId: "agent:qa",
        status: "active",
        canInspectRenderedPages: true,
        verifiedAt: beforeNow,
      },
    ],
    parserRecords: [
      {
        purpose: "docx_parse",
        profileHash: hash(70),
        workerName: "safe-ooxml-parser",
        workerVersion: "1.0.0",
        packageLimits,
        noNetwork: true,
        status: "active",
        verifiedAt: beforeNow,
      },
      {
        purpose: "template_inspect",
        profileHash: hash(76),
        workerName: "safe-template-inspector",
        workerVersion: "1.0.0",
        packageLimits,
        noNetwork: true,
        status: "active",
        verifiedAt: beforeNow,
      },
    ],
    rendererRecords: [
      {
        rendererName: "libreoffice-headless",
        rendererVersion: "26.2",
        runtimeHash: hash(59),
        configurationHash: hash(60),
        fontPackHash: hash(61),
        noNetwork: true,
        status: "active",
        verifiedAt: beforeNow,
      },
    ],
    comparatorRecords: [
      {
        comparatorName: "pixelmatch",
        comparatorVersion: "1.0.0",
        runtimeHash: hash(130),
        configurationHash: hash(65),
        noNetwork: true,
        status: "active",
        verifiedAt: beforeNow,
      },
    ],
    workerRecords: [
      {
        purpose: "docx_apply_changeset",
        profileHash: hash(118),
        workerName: "deterministic-docx-builder",
        workerVersion: "1.0.0",
        runtimeHash: hash(54),
        configurationHash: hash(55),
        noNetwork: true,
        status: "active",
        verifiedAt: beforeNow,
      },
      {
        purpose: "docx_text_diff",
        profileHash: hash(123),
        workerName: "resume-semantic-differ",
        workerVersion: "1.0.0",
        runtimeHash: hash(121),
        configurationHash: hash(122),
        noNetwork: true,
        status: "active",
        verifiedAt: beforeNow,
      },
      {
        purpose: "docx_privacy_scrub",
        profileHash: hash(117),
        workerName: "trusted-privacy-scrubber",
        workerVersion: "1.0.0",
        runtimeHash: hash(119),
        configurationHash: hash(120),
        noNetwork: true,
        status: "active",
        verifiedAt: beforeNow,
      },
      {
        purpose: "docx_structure_audit",
        profileHash: hash(124),
        workerName: "trusted-document-auditor",
        workerVersion: "1.0.0",
        runtimeHash: hash(114),
        configurationHash: hash(115),
        noNetwork: true,
        status: "active",
        verifiedAt: beforeNow,
      },
    ],
    qaEvidenceRecords,
    nonCreationEvidenceRecords: [],
  };
}

function allArtifactRecords() {
  const creationByArtifactId = new Map<string, { creatingOperationId: string; resumeVersionId: string }>([
    [builtDocument.artifactId, { creatingOperationId: "operation:apply", resumeVersionId: "resume:1" }],
    [outputSnapshotArtifact.artifactId, { creatingOperationId: "operation:apply", resumeVersionId: "resume:1" }],
    [buildManifestArtifact.artifactId, { creatingOperationId: "operation:apply", resumeVersionId: "resume:1" }],
    [scrubbedDocument.artifactId, { creatingOperationId: "operation:scrub", resumeVersionId: "resume:1" }],
    [scrubbedSnapshotArtifact.artifactId, { creatingOperationId: "operation:scrub", resumeVersionId: "resume:1" }],
    [privacyReportArtifact.artifactId, { creatingOperationId: "operation:scrub", resumeVersionId: "resume:1" }],
    [exportManifestArtifact.artifactId, { creatingOperationId: "operation:export", resumeVersionId: "resume:1" }],
  ]);
  return [
    sourceDocument,
    templateDocument,
    builtDocument,
    scrubbedDocument,
    sourceSnapshotArtifact,
    outputSnapshotArtifact,
    scrubbedSnapshotArtifact,
    templateSnapshotArtifact,
    templateProfileArtifact,
    presentationPlanArtifact,
    buildManifestArtifact,
    textDiffArtifact,
    renderManifestArtifact,
    baseRenderArtifact,
    visualDiffArtifact,
    privacyReportArtifact,
    qaReportArtifact,
    exportManifestArtifact,
    pageOne,
    pageTwo,
    basePageOne,
    basePageTwo,
    diffPageOne,
    diffPageTwo,
    ...qaEvidenceArtifacts,
  ].map((artifact) =>
    trustedArtifact(
      artifact,
      artifact.contentHash,
      creationByArtifactId.get(artifact.artifactId),
    ),
  );
}

function readScope(operationId: string) {
  return {
    contractVersion: "1.0.0" as const,
    requestId: `request:${operationId}`,
    operationId,
    profileId: "profile:1",
    resumeVersionId: "resume:1",
    expectedResumeRevision: 7,
    deadlineAt: later,
  };
}

function parseRequest() {
  return {
    ...readScope("parse"),
    sourceDocument,
    packageLimits,
    parserProfileHash: hash(70),
  };
}

function applyContext(): DocumentValidationContext {
  return {
    ...emptyContext(),
    artifactRecords: allArtifactRecords(),
    snapshots: [sourceSnapshot, templateSnapshot],
    templateProfiles: [templateProfile],
    resumeRecord: resumeRecord("user_approved"),
    changeSet,
    reviews: [review],
    contentApproval,
    factSnapshot,
    facts: [
      {
        factId: "fact:name",
        profileId: "profile:1",
        version: 1,
        factHash: hash(116),
        status: "verified",
        sourceArtifactIds: ["artifact:source"],
      },
      {
        factId: "fact:achievement",
        profileId: "profile:1",
        version: 1,
        factHash: hash(53),
        status: "verified",
        sourceArtifactIds: ["artifact:source"],
      },
    ],
    requirementSnapshot,
    requirements: [
      {
        requirementId: "requirement:distributed",
        jobId: "job:1",
        requirementHash: hash(71),
      },
    ],
    templateRecord: {
      templateId: "template:1",
      templateVersion: "1.0.0",
      artifactId: "artifact:template",
      artifactHash: hash(2),
      profileHash: hash(51),
      status: "active",
      verifiedAt: beforeNow,
    },
  };
}

async function policyAuthorization(
  tool: "docx_apply_changeset" | "docx_privacy_scrub",
  operationId: string,
  source: typeof sourceDocument | typeof builtDocument,
) {
  return {
    kind: "policy_grant" as const,
    tool,
    operationId,
    actionFingerprint: hash(72),
    resumeVersionId: "resume:1",
    expectedResumeRevision: 7,
    sourceArtifactId: source.artifactId,
    sourceArtifactHash: source.contentHash,
    risk: "reversible" as const,
    decisionId: `decision:${operationId}`,
    policyVersion: "document-policy-v1",
    grantHash: hash(73),
    issuedAt: beforeNow,
    expiresAt: muchLater,
    executionReservationId: `reservation:${operationId}`,
    executionNonce: nonce,
    executionLeaseExpiresAt: later,
  };
}

async function trustedPolicyRecord(
  authorization: Awaited<ReturnType<typeof policyAuthorization>>,
) {
  const { executionNonce, ...safe } = authorization;
  return DocumentTrustedAuthorizationRecordSchema.parse({
    ...safe,
    executionNonceHash: await sha256(executionNonce),
    status: "executing",
    reservedAt: beforeNow,
  });
}

async function applyEffectAuthorization() {
  return {
    kind: "effect_claim" as const,
    tool: "docx_apply_changeset" as const,
    operationId: "operation:apply",
    actionFingerprint: hash(72),
    resumeVersionId: "resume:1",
    expectedResumeRevision: 7,
    sourceArtifactId: sourceDocument.artifactId,
    sourceArtifactHash: sourceDocument.contentHash,
    risk: "reversible" as const,
    approvalId: "content-approval:1",
    dispatchEffectId: "effect:apply",
    workerId: "worker:document-1",
    claimToken: "a".repeat(32),
    claimedAt: beforeNow,
    expiresAt: muchLater,
    executionReservationId: "reservation:apply",
    executionNonce: nonce,
    executionLeaseExpiresAt: later,
  };
}

async function trustedApplyEffectRecord(
  authorization: Awaited<ReturnType<typeof applyEffectAuthorization>>,
) {
  const { executionNonce, claimToken, ...safe } = authorization;
  return DocumentTrustedAuthorizationRecordSchema.parse({
    ...safe,
    executionNonceHash: await sha256(executionNonce),
    claimTokenHash: await sha256(claimToken),
    status: "executing",
    reservedAt: beforeNow,
  });
}

async function applyFixture() {
  const authorization = await applyEffectAuthorization();
  const fixtureChangeSet = structuredClone(changeSet);
  fixtureChangeSet.resultContentHash = await sha256(canonicalize(resultResume));
  fixtureChangeSet.baseResumeVersionId = "resume:base";
  const fixtureReview = structuredClone(review);
  fixtureReview.reviewedChangeHash = await sha256(
    canonicalize(fixtureChangeSet.changes[0]),
  );
  const fixtureContentApproval = {
    ...contentApproval,
    approvedContentHash: fixtureChangeSet.resultContentHash,
  };
  const request = {
    ...readScope("operation:apply"),
    baseResume: {
      resumeVersionId: "resume:base",
      profileId: "profile:1",
      expectedResumeRevision: 4,
      expectedResumeStatus: "user_approved" as const,
      sourceContentHash: hash(1),
    },
    resume: {
      resumeVersionId: "resume:1",
      profileId: "profile:1",
      expectedResumeRevision: 7,
      expectedResumeStatus: "user_approved" as const,
      sourceContentHash: fixtureChangeSet.resultContentHash,
    },
    sourceDocument,
    sourceSnapshotHash: hash(45),
    changeSet: fixtureChangeSet,
    reviews: [fixtureReview],
    contentApproval: fixtureContentApproval,
    factSnapshot,
    requirementSnapshot,
    template: templateProfile,
    resultResume,
    presentationPlan: {
      items: presentationPlanItems,
      planArtifact: presentationPlanArtifact,
      planHash: presentationPlanHash,
    },
    builderProfileHash: hash(118),
    presentation: "clean" as const,
    authorization,
  };
  request.authorization.actionFingerprint = await computeDocumentActionFingerprint(
    "docx_apply_changeset",
    request,
  );
  const context = applyContext();
  context.resumeRecord = {
    version: {
      id: "resume:1",
      profileId: "profile:1",
      jobId: "job:1",
      parentVersionId: "resume:base",
      templateId: "template:1",
      resume: resultResume,
      changeSetId: "changeset:1",
      status: "user_approved",
      contentHash: fixtureChangeSet.resultContentHash,
      createdAt: beforeNow,
      updatedAt: beforeNow,
    },
    revision: 7,
  };
  context.baseResumeRecord = {
    version: {
      id: "resume:base",
      profileId: "profile:1",
      jobId: "job:1",
      templateId: "template:1",
      resume: baseResume,
      status: "user_approved",
      contentHash: hash(1),
      createdAt: beforeNow,
      updatedAt: beforeNow,
    },
    revision: 4,
    documentArtifactId: sourceDocument.artifactId,
    documentArtifactHash: sourceDocument.contentHash,
    documentSnapshotHash: sourceSnapshot.snapshotHash,
    contentBindings: [
      {
        contentItemId: "item:summary",
        outputBlockId: "block:summary",
        outputTextHash: oldTextHash,
      },
    ],
  };
  context.changeSet = fixtureChangeSet;
  context.reviews = [fixtureReview];
  context.contentApproval = fixtureContentApproval;
  context.authorizationRecord = await trustedApplyEffectRecord(request.authorization);
  return { request, context };
}

async function applyResultFixture() {
  const fixture = await applyFixture();
  const manifest = structuredClone(buildManifest);
  manifest.resultContentHash = fixture.request.changeSet.resultContentHash;
  manifest.changeSetId = fixture.request.changeSet.id;
  manifest.changeSetHash = fixture.request.changeSet.contentHash;
  manifest.contentApprovalId = fixture.request.contentApproval.id;
  manifest.contentApprovalHash = await sha256(
    canonicalize(fixture.request.contentApproval),
  );
  manifest.factSnapshotHash = fixture.request.factSnapshot.snapshotHash;
  manifest.requirementSnapshotHash =
    fixture.request.requirementSnapshot.snapshotHash;
  manifest.sourceSnapshotHash = fixture.request.sourceSnapshotHash;
  manifest.outputSnapshotHash = outputSnapshot.snapshotHash;
  manifest.manifestHash = hash(125);

  const authorizationReceipt = {
    ...fixture.context.authorizationRecord!,
  } as Record<string, unknown>;
  delete authorizationReceipt.status;
  delete authorizationReceipt.reservedAt;
  const output = {
    result: {
      contractVersion: "1.0.0" as const,
      requestId: fixture.request.requestId,
      operationId: fixture.request.operationId,
      profileId: fixture.request.profileId,
      tool: "docx_apply_changeset" as const,
      startedAt: beforeNow,
      completedAt: now,
      outcome: "verified_created" as const,
      actionFingerprint: fixture.request.authorization.actionFingerprint,
      authorizationReceipt,
      outputDocument: builtDocument,
      outputSnapshot,
      buildManifest: manifest,
      evidenceArtifactIds: [buildManifestArtifact.artifactId],
    },
  };
  const resultContext = structuredClone(fixture.context);
  resultContext.snapshots = [sourceSnapshot, templateSnapshot, outputSnapshot];
  resultContext.buildManifests = [manifest];
  return { ...fixture, manifest, output, resultContext };
}

async function privacyFixture() {
  const authorization = await policyAuthorization(
    "docx_privacy_scrub",
    "operation:scrub",
    builtDocument,
  );
  const request = {
    ...readScope("operation:scrub"),
    resume: {
      resumeVersionId: "resume:1",
      profileId: "profile:1",
      expectedResumeRevision: 7,
      expectedResumeStatus: "docx_built" as const,
      sourceContentHash: hash(3),
    },
    sourceDocument: builtDocument,
    sourceSnapshotHash: hash(47),
    buildManifestHash: hash(57),
    policyVersion: "privacy-v1",
    policyHash: hash(67),
    scrubberProfileHash: hash(117),
    visibleContentPolicy: "preserve_exactly" as const,
    authorization,
  };
  request.authorization.actionFingerprint = await computeDocumentActionFingerprint(
    "docx_privacy_scrub",
    request,
  );
  const context: DocumentValidationContext = {
    ...emptyContext(),
    artifactRecords: allArtifactRecords(),
    snapshots: [outputSnapshot],
    buildManifests: [buildManifest],
    resumeRecord: resumeRecord("docx_built"),
    authorizationRecord: await trustedPolicyRecord(request.authorization),
  };
  const receipt = {
    ...context.authorizationRecord,
  } as Record<string, unknown>;
  delete receipt.status;
  delete receipt.reservedAt;
  const output = {
    result: {
      contractVersion: "1.0.0" as const,
      requestId: request.requestId,
      operationId: request.operationId,
      profileId: "profile:1",
      tool: "docx_privacy_scrub" as const,
      startedAt: beforeNow,
      completedAt: now,
      outcome: "verified_created" as const,
      actionFingerprint: request.authorization.actionFingerprint,
      authorizationReceipt: receipt,
      outputDocument: scrubbedDocument,
      report: privacyReport,
      evidenceArtifactIds: ["artifact:privacy-report"],
    },
  };
  const resultContext = structuredClone(context);
  resultContext.snapshots = [outputSnapshot, scrubbedSnapshot];
  resultContext.privacyReports = [privacyReport];
  return { request, context, output, resultContext };
}

async function exportAuthorization() {
  return {
    kind: "effect_claim" as const,
    tool: "artifact_export" as const,
    operationId: "operation:export",
    actionFingerprint: hash(74),
    resumeVersionId: "resume:1",
    expectedResumeRevision: 7,
    sourceArtifactId: scrubbedDocument.artifactId,
    sourceArtifactHash: scrubbedDocument.contentHash,
    risk: "consequential" as const,
    approvalId: "approval:export",
    dispatchEffectId: "effect:export",
    workerId: "worker:document-1",
    claimToken: "c".repeat(32),
    claimedAt: beforeNow,
    expiresAt: muchLater,
    executionReservationId: "reservation:export",
    executionNonce: nonce,
    executionLeaseExpiresAt: later,
    qaReportHash: hash(69),
    exportedArtifactHash: hash(3),
  };
}

async function trustedExportRecord(
  authorization: Awaited<ReturnType<typeof exportAuthorization>>,
) {
  const { executionNonce, claimToken, ...safe } = authorization;
  return DocumentTrustedAuthorizationRecordSchema.parse({
    ...safe,
    executionNonceHash: await sha256(executionNonce),
    claimTokenHash: await sha256(claimToken),
    status: "executing",
    reservedAt: beforeNow,
  });
}

async function exportFixture() {
  const authorization = await exportAuthorization();
  const request = {
    ...readScope("operation:export"),
    resume: {
      resumeVersionId: "resume:1",
      profileId: "profile:1",
      expectedResumeRevision: 7,
      expectedResumeStatus: "qa_passed" as const,
      sourceContentHash: hash(3),
    },
    sourceDocument: scrubbedDocument,
    contentApproval,
    buildManifestHash: hash(57),
    privacyReportHash: hash(68),
    renderSetHash: hash(62),
    qaReport,
    exportFileName: "tailored-resume.docx",
    format: "docx" as const,
    destination: "user_download" as const,
    authorization,
  };
  request.authorization.actionFingerprint = await computeDocumentActionFingerprint(
    "artifact_export",
    request,
  );
  const context: DocumentValidationContext = {
    ...emptyContext(),
    artifactRecords: allArtifactRecords(),
    renderManifests: [candidateRender],
    buildManifests: [buildManifest],
    privacyReports: [privacyReport],
    qaReports: [qaReport],
    resumeRecord: resumeRecord("qa_passed"),
    contentApproval,
    authorizationRecord: await trustedExportRecord(request.authorization),
  };
  return { request, context };
}

describe("Document MCP contract", () => {
  it("publishes a stable cross-worker canonical presentation-plan hash", async () => {
    expect(await computeDocumentCanonicalHash(presentationPlanItems)).toBe(
      presentationPlanHash,
    );
    expect(
      await computeDocumentCanonicalHash([
        presentationPlanItems[1],
        presentationPlanItems[0],
      ]),
    ).not.toBe(presentationPlanHash);
  });

  it("publishes exactly nine strict, closed-world tools over the MCP wire", () => {
    const expectedNames = [
      "docx_parse",
      "template_inspect",
      "docx_apply_changeset",
      "docx_text_diff",
      "docx_render_pages",
      "docx_visual_diff",
      "docx_structure_audit",
      "docx_privacy_scrub",
      "artifact_export",
    ];
    const wire = buildDocumentMcpWireTools();

    expect(wire.map((tool) => tool.name)).toEqual(expectedNames);
    expect(Object.keys(documentMcpToolCatalog)).toEqual(expectedNames);
    for (const tool of wire) {
      const contract = documentMcpToolCatalog[tool.name];
      expect(DocumentMcpToolDescriptorSchema.parse(contract.descriptor).name).toBe(tool.name);
      expect((tool.inputSchema as Record<string, unknown>).type).toBe("object");
      expect((tool.inputSchema as Record<string, unknown>).additionalProperties).toBe(false);
      expect((tool.outputSchema as Record<string, unknown>).type).toBe("object");
      expect((tool.outputSchema as Record<string, unknown>).additionalProperties).toBe(false);
      expect(tool.annotations.openWorldHint).toBe(false);
    }

    expect(() =>
      DocumentMcpToolDescriptorSchema.parse({
        ...documentMcpToolCatalog.docx_parse.descriptor,
        undocumentedCapability: true,
      }),
    ).toThrow();
  });

  it("rejects paths, URLs/storage keys, traversal filenames, and unknown fields", () => {
    const request = parseRequest();
    expect(DocxParseInputSchema.safeParse(request).success).toBe(true);
    expect(
      DocxParseInputSchema.safeParse({
        ...request,
        sourceDocument: { ...sourceDocument, fileName: "../secrets.docx" },
      }).success,
    ).toBe(false);
    expect(
      DocxParseInputSchema.safeParse({
        ...request,
        sourceDocument: { ...sourceDocument, localPath: "C:\\private\\resume.docx" },
      }).success,
    ).toBe(false);
    expect(
      DocxParseInputSchema.safeParse({
        ...request,
        sourceDocument: { ...sourceDocument, downloadUrl: "https://example.invalid/resume" },
      }).success,
    ).toBe(false);
    expect(DocxParseInputSchema.safeParse({ ...request, trustedContext: {} }).success).toBe(false);
  });

  it("requires artifact metadata and the server-observed byte hash to match exactly", () => {
    const request = parseRequest();
    const context: DocumentValidationContext = {
      ...emptyContext(),
      artifactRecords: [trustedArtifact(sourceDocument)],
      resumeRecord: resumeRecord("user_approved"),
    };
    expect(validateDocumentReadRequest("docx_parse", request, context).success).toBe(true);

    const tampered = structuredClone(context);
    tampered.artifactRecords[0]!.actualByteHash = hash(99);
    const result = validateDocumentReadRequest("docx_parse", request, tampered);
    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("ARTIFACT_TRUST_MISMATCH");
  });

  it("binds writes to a canonical fingerprint and a live one-time reservation", async () => {
    const { request, context } = await applyFixture();
    const valid = await validateDocumentWriteRequest(
      "docx_apply_changeset",
      request,
      context,
    );
    expect(valid.issues).toEqual([]);

    const changedPayload = structuredClone(request) as Omit<typeof request, "presentation"> & {
      presentation: "clean" | "tracked_changes" | "tracked_changes_with_comments";
    };
    changedPayload.presentation = "tracked_changes";
    const changedFingerprint = await computeDocumentActionFingerprint(
      "docx_apply_changeset",
      changedPayload,
    );
    expect(changedFingerprint).not.toBe(request.authorization.actionFingerprint);
    const staleGrant = await validateDocumentWriteRequest(
      "docx_apply_changeset",
      changedPayload,
      context,
    );
    expect(staleGrant.issues.map((issue) => issue.code)).toContain("AUTHORIZATION_MISMATCH");

    const replay = structuredClone(request);
    replay.authorization.executionNonce = "x".repeat(32);
    const replayResult = await validateDocumentWriteRequest(
      "docx_apply_changeset",
      replay,
      context,
    );
    expect(replayResult.issues.map((issue) => issue.code)).toContain("AUTHORIZATION_MISMATCH");

    const swappedReservation = structuredClone(request);
    swappedReservation.authorization.executionReservationId = "reservation:other";
    const swappedResult = await validateDocumentWriteRequest(
      "docx_apply_changeset",
      swappedReservation,
      context,
    );
    expect(swappedResult.issues.map((issue) => issue.code)).toContain("AUTHORIZATION_MISMATCH");
  });

  it("maps ResumeIR content IDs to DOCX blocks and rejects text or block substitution", async () => {
    const fixture = await applyResultFixture();
    const valid = await validateDocumentWriteResult(
      "docx_apply_changeset",
      fixture.request,
      fixture.output,
      fixture.resultContext,
    );
    expect(valid.issues).toEqual([]);
    expect(fixture.manifest.operations[0]).toEqual(
      expect.objectContaining({
        contentItemId: "item:summary",
        targetBlockId: "block:summary",
      }),
    );
    expect(fixture.manifest.presentationBindings).toEqual([
      {
        presentationItemId: "presentation:header",
        outputBlockId: "block:header",
        outputTextHash: headerTextHash,
      },
      {
        presentationItemId: "presentation:summary",
        outputBlockId: "block:summary",
        outputTextHash: newTextHash,
      },
    ]);

    const reorderedOutput = structuredClone(fixture.output);
    reorderedOutput.result.outputSnapshot.blocks[0]!.ordinal = 1;
    reorderedOutput.result.outputSnapshot.blocks[1]!.ordinal = 0;
    reorderedOutput.result.outputSnapshot.semanticTextHash = await sha256(
      canonicalize(
        reorderedOutput.result.outputSnapshot.blocks.map((block: any) => ({
          ordinal: block.ordinal,
          story: block.story,
          kind: block.kind,
          text: block.text,
        })),
      ),
    );
    const reorderedContext = structuredClone(fixture.resultContext);
    reorderedContext.snapshots = [
      sourceSnapshot,
      templateSnapshot,
      structuredClone(reorderedOutput.result.outputSnapshot),
    ];
    const reordered = await validateDocumentWriteResult(
      "docx_apply_changeset",
      fixture.request,
      reorderedOutput,
      reorderedContext,
    );
    expect(reordered.issues.map((issue) => issue.code)).toContain(
      "APPLY_RESULT_LINEAGE_MISMATCH",
    );

    const missingTemplateContext = structuredClone(fixture.resultContext);
    missingTemplateContext.snapshots = [sourceSnapshot, outputSnapshot];
    const missingTemplate = await validateDocumentWriteResult(
      "docx_apply_changeset",
      fixture.request,
      fixture.output,
      missingTemplateContext,
    );
    expect(missingTemplate.issues.map((issue) => issue.code)).toContain(
      "APPLY_TEMPLATE_SNAPSHOT_INVALID",
    );

    const tamperedTextOutput = structuredClone(fixture.output) as any;
    const tamperedText = "Invented an unapproved achievement.";
    const tamperedHash = await sha256(tamperedText);
    tamperedTextOutput.result.outputSnapshot.blocks[1].text = tamperedText;
    tamperedTextOutput.result.outputSnapshot.blocks[1].textHash = tamperedHash;
    tamperedTextOutput.result.outputSnapshot.semanticTextHash = await sha256(
      canonicalize([
        {
          ordinal: 0,
          story: "body",
          kind: "paragraph",
          text: "Yifan Zhu",
        },
        {
          ordinal: 1,
          story: "body",
          kind: "paragraph",
          text: tamperedText,
        },
      ]),
    );
    tamperedTextOutput.result.buildManifest.operations[0].replacementTextHash =
      tamperedHash;
    tamperedTextOutput.result.buildManifest.presentationBindings[1].outputTextHash =
      tamperedHash;
    tamperedTextOutput.result.buildManifest.claimProvenance[0].outputTextHash =
      tamperedHash;
    const tamperedTextContext = structuredClone(fixture.resultContext);
    tamperedTextContext.snapshots = [
      sourceSnapshot,
      templateSnapshot,
      structuredClone(tamperedTextOutput.result.outputSnapshot),
    ];
    tamperedTextContext.buildManifests = [
      structuredClone(tamperedTextOutput.result.buildManifest),
    ];
    const tamperedTextResult = await validateDocumentWriteResult(
      "docx_apply_changeset",
      fixture.request,
      tamperedTextOutput,
      tamperedTextContext,
    );
    expect(tamperedTextResult.issues.map((issue) => issue.code)).toContain(
      "APPLY_RESULT_LINEAGE_MISMATCH",
    );

    const swappedSlotOutput = structuredClone(fixture.output) as any;
    swappedSlotOutput.result.outputSnapshot.snapshotHash = hash(126);
    swappedSlotOutput.result.outputSnapshot.blocks = [
      {
        ...sourceSnapshot.blocks[0]!,
        id: "block:summary",
        ordinal: 0,
      },
      {
        ...outputSnapshot.blocks[0]!,
        id: "block:skills",
        ordinal: 1,
      },
    ];
    swappedSlotOutput.result.outputSnapshot.semanticTextHash =
      swappedSlotSemanticTextHash;
    swappedSlotOutput.result.buildManifest.outputSnapshotHash = hash(126);
    swappedSlotOutput.result.buildManifest.manifestHash = hash(127);
    swappedSlotOutput.result.buildManifest.operations[0].targetBlockId =
      "block:skills";
    swappedSlotOutput.result.buildManifest.operations[0].expectedTextHash =
      skillsTextHash;
    swappedSlotOutput.result.buildManifest.presentationBindings[1].outputBlockId =
      "block:skills";
    swappedSlotOutput.result.buildManifest.claimProvenance[0].outputBlockId =
      "block:skills";
    const swappedSlotContext = structuredClone(fixture.resultContext);
    swappedSlotContext.snapshots = [
      sourceSnapshot,
      templateSnapshot,
      structuredClone(swappedSlotOutput.result.outputSnapshot),
    ];
    swappedSlotContext.buildManifests = [
      structuredClone(swappedSlotOutput.result.buildManifest),
    ];
    const swappedSlotResult = await validateDocumentWriteResult(
      "docx_apply_changeset",
      fixture.request,
      swappedSlotOutput,
      swappedSlotContext,
    );
    expect(swappedSlotResult.issues.map((issue) => issue.code)).toContain(
      "APPLY_RESULT_LINEAGE_MISMATCH",
    );

    const extraDynamicBlockOutput = structuredClone(fixture.output) as any;
    extraDynamicBlockOutput.result.outputSnapshot.snapshotHash = hash(128);
    extraDynamicBlockOutput.result.outputSnapshot.blocks.push({
      ...templateSnapshot.blocks.find((block) => block.id === "block:skills")!,
      ordinal: 1,
    });
    extraDynamicBlockOutput.result.outputSnapshot.semanticTextHash =
      extraDynamicBlockSemanticTextHash;
    extraDynamicBlockOutput.result.buildManifest.outputSnapshotHash = hash(128);
    extraDynamicBlockOutput.result.buildManifest.manifestHash = hash(129);
    const extraDynamicBlockContext = structuredClone(fixture.resultContext);
    extraDynamicBlockContext.snapshots = [
      sourceSnapshot,
      templateSnapshot,
      structuredClone(extraDynamicBlockOutput.result.outputSnapshot),
    ];
    extraDynamicBlockContext.buildManifests = [
      structuredClone(extraDynamicBlockOutput.result.buildManifest),
    ];
    const extraDynamicBlockResult = await validateDocumentWriteResult(
      "docx_apply_changeset",
      fixture.request,
      extraDynamicBlockOutput,
      extraDynamicBlockContext,
    );
    expect(extraDynamicBlockResult.issues.map((issue) => issue.code)).toContain(
      "APPLY_RESULT_LINEAGE_MISMATCH",
    );

    const substitutedOutput = structuredClone(fixture.output);
    substitutedOutput.result.outputDocument.artifactId = "artifact:substituted";
    const substitutedResult = await validateDocumentWriteResult(
      "docx_apply_changeset",
      fixture.request,
      substitutedOutput,
      fixture.resultContext,
    );
    expect(substitutedResult.issues.map((issue) => issue.code)).toContain(
      "ARTIFACT_TRUST_MISMATCH",
    );
  });

  it("rejects a text-diff hunk whose change ID is right but DOCX block is wrong", async () => {
    const request = {
      ...readScope("operation:text-diff"),
      baseDocument: sourceDocument,
      candidateDocument: scrubbedDocument,
      baseSnapshotHash: sourceSnapshot.snapshotHash,
      candidateSnapshotHash: scrubbedSnapshot.snapshotHash,
      changeSetId: changeSet.id,
      changeSetHash: changeSet.contentHash,
      buildManifestHash: buildManifest.manifestHash,
      differProfileHash: hash(123),
    };
    const output = {
      result: {
        contractVersion: "1.0.0" as const,
        requestId: request.requestId,
        operationId: request.operationId,
        profileId: request.profileId,
        tool: "docx_text_diff" as const,
        startedAt: beforeNow,
        completedAt: now,
        outcome: "success" as const,
        report: textDiffReport,
      },
    };
    const context: DocumentValidationContext = {
      ...emptyContext(),
      artifactRecords: allArtifactRecords(),
      snapshots: [sourceSnapshot, scrubbedSnapshot],
      buildManifests: [buildManifest],
      textDiffReports: [textDiffReport],
      privacyReports: [privacyReport],
      resumeRecord: resumeRecord("qa_passed"),
      changeSet,
    };
    const valid = await validateDocumentReadResult(
      "docx_text_diff",
      request,
      output,
      context,
    );
    expect(valid.issues).toEqual([]);

    const mismatchedOutput = structuredClone(output);
    mismatchedOutput.result.report.hunks[0]!.blockId = "block:skills";
    const mismatchedContext = structuredClone(context);
    mismatchedContext.textDiffReports = [
      structuredClone(mismatchedOutput.result.report),
    ];
    const mismatch = await validateDocumentReadResult(
      "docx_text_diff",
      request,
      mismatchedOutput,
      mismatchedContext,
    );
    expect(mismatch.issues.map((issue) => issue.code)).toContain(
      "TEXT_DIFF_RESULT_INVALID",
    );
  });

  it("accepts deletion of a middle block without reporting the following ordinal shift", async () => {
    const makeBlock = async (id: string, ordinal: number, text: string) => ({
      id,
      ordinal,
      story: "body" as const,
      kind: "paragraph" as const,
      text,
      textHash: await sha256(text),
      styleId: "Body",
      sensitivity: "normal" as const,
    });
    const first = await makeBlock("block:first", 0, "First unchanged block");
    const middle = await makeBlock("block:middle", 1, "Remove this middle block");
    const lastBefore = await makeBlock("block:last", 2, "Last unchanged block");
    const lastAfter = { ...lastBefore, ordinal: 1 };
    const semanticHash = (blocks: Array<typeof first>) =>
      sha256(
        canonicalize(
          blocks.map((block) => ({
            ordinal: block.ordinal,
            story: block.story,
            kind: block.kind,
            text: block.text,
          })),
        ),
      );
    const baseSnapshot = {
      ...sourceSnapshot,
      snapshotId: "snapshot:delete-base",
      snapshotHash: hash(130),
      blocks: [first, middle, lastBefore],
      semanticTextHash: await semanticHash([first, middle, lastBefore]),
    };
    const candidateSnapshot = {
      ...outputSnapshot,
      snapshotId: "snapshot:delete-candidate",
      snapshotHash: hash(131),
      blocks: [first, lastAfter],
      semanticTextHash: await semanticHash([first, lastAfter]),
    };
    const deleteChangeSet = {
      ...structuredClone(changeSet),
      id: "changeset:delete-middle",
      contentHash: hash(132),
      changes: [
        {
          id: "change:delete-middle",
          targetItemId: "item:middle",
          factIds: ["fact:achievement"],
          requirementIds: [],
          rationale: "Remove an approved obsolete item.",
          intent: "remove" as const,
          before: middle.text,
          after: null,
        },
      ],
    };
    const deleteManifest = {
      ...structuredClone(buildManifest),
      manifestId: "build-manifest:delete-middle",
      operationId: "operation:delete-middle",
      changeSetId: deleteChangeSet.id,
      changeSetHash: deleteChangeSet.contentHash,
      sourceSnapshotHash: baseSnapshot.snapshotHash,
      outputSnapshotHash: candidateSnapshot.snapshotHash,
      operations: [
        {
          id: "operation:remove-middle",
          changeId: "change:delete-middle",
          contentItemId: "item:middle",
          kind: "remove_block" as const,
          targetBlockId: "block:middle",
          expectedTextHash: middle.textHash,
        },
      ],
      claimProvenance: [],
      manifestHash: hash(133),
    };
    const report = {
      ...structuredClone(textDiffReport),
      reportId: "text-diff:delete-middle",
      candidateDocument: builtDocument,
      baseSemanticTextHash: baseSnapshot.semanticTextHash,
      candidateSemanticTextHash: candidateSnapshot.semanticTextHash,
      changeSetId: deleteChangeSet.id,
      changeSetHash: deleteChangeSet.contentHash,
      buildManifestHash: deleteManifest.manifestHash,
      hunks: [
        {
          id: "hunk:delete-middle",
          changeId: "change:delete-middle",
          story: "body" as const,
          blockId: "block:middle",
          kind: "delete" as const,
          beforeTextHash: middle.textHash,
          approved: true,
        },
      ],
      expectedChangeIds: ["change:delete-middle"],
      reportHash: hash(134),
    };
    const request = {
      ...readScope("operation:delete-diff"),
      baseDocument: sourceDocument,
      candidateDocument: builtDocument,
      baseSnapshotHash: baseSnapshot.snapshotHash,
      candidateSnapshotHash: candidateSnapshot.snapshotHash,
      changeSetId: deleteChangeSet.id,
      changeSetHash: deleteChangeSet.contentHash,
      buildManifestHash: deleteManifest.manifestHash,
      differProfileHash: hash(123),
    };
    const output = {
      result: {
        contractVersion: "1.0.0" as const,
        requestId: request.requestId,
        operationId: request.operationId,
        profileId: request.profileId,
        tool: "docx_text_diff" as const,
        startedAt: beforeNow,
        completedAt: now,
        outcome: "success" as const,
        report,
      },
    };
    const context: DocumentValidationContext = {
      ...emptyContext(),
      artifactRecords: allArtifactRecords(),
      snapshots: [baseSnapshot, candidateSnapshot],
      buildManifests: [deleteManifest],
      textDiffReports: [report],
      resumeRecord: resumeRecord("qa_passed"),
      changeSet: deleteChangeSet,
    };
    const validation = await validateDocumentReadResult(
      "docx_text_diff",
      request,
      output,
      context,
    );
    expect(validation.issues).toEqual([]);
    expect(report.hunks.map((hunk) => hunk.blockId)).toEqual(["block:middle"]);
  });

  it("rejects an unapproved change, stale fact binding, and wrong resume version state", async () => {
    const fixture = await applyFixture();

    const rejectedRequest = structuredClone(fixture.request) as Omit<
      typeof fixture.request,
      "reviews"
    > & {
      reviews: Array<
        Omit<(typeof fixture.request.reviews)[number], "decision"> & {
          decision: "approved" | "rejected";
        }
      >;
    };
    rejectedRequest.reviews[0]!.decision = "rejected";
    const rejectedContext = structuredClone(fixture.context);
    rejectedContext.reviews = structuredClone(rejectedRequest.reviews);
    rejectedRequest.authorization.actionFingerprint = await computeDocumentActionFingerprint(
      "docx_apply_changeset",
      rejectedRequest,
    );
    rejectedContext.authorizationRecord = await trustedApplyEffectRecord(
      rejectedRequest.authorization,
    );
    const rejected = await validateDocumentWriteRequest(
      "docx_apply_changeset",
      rejectedRequest,
      rejectedContext,
    );
    expect(rejected.issues.map((issue) => issue.code)).toContain("CHANGE_REVIEW_MISMATCH");

    const staleFactContext = structuredClone(fixture.context);
    staleFactContext.facts.find(
      (fact) => fact.factId === "fact:achievement",
    )!.version = 2;
    const staleFact = await validateDocumentWriteRequest(
      "docx_apply_changeset",
      fixture.request,
      staleFactContext,
    );
    expect(staleFact.issues.map((issue) => issue.code)).toContain("UNVERIFIED_FACT_BINDING");

    const wrongVersionContext = structuredClone(fixture.context);
    wrongVersionContext.resumeRecord!.version.status = "docx_built";
    const wrongVersion = await validateDocumentWriteRequest(
      "docx_apply_changeset",
      fixture.request,
      wrongVersionContext,
    );
    expect(wrongVersion.issues.map((issue) => issue.code)).toContain("RESUME_BINDING_MISMATCH");
  });

  it("rejects a render that omits a declared page", async () => {
    const request = {
      ...readScope("operation:render"),
      sourceDocument: scrubbedDocument,
      sourceSnapshotHash: hash(78),
      rendererName: "libreoffice-headless",
      rendererVersion: "26.2",
      runtimeHash: hash(59),
      configurationHash: hash(60),
      fontPackHash: hash(61),
      revisionView: "clean" as const,
      dpi: 150,
    };
    const incomplete = structuredClone(candidateRender);
    incomplete.pageCount = 2;
    incomplete.pages = [incomplete.pages[0]!];
    const output = {
      result: {
        contractVersion: "1.0.0" as const,
        requestId: request.requestId,
        operationId: request.operationId,
        profileId: request.profileId,
        tool: "docx_render_pages" as const,
        startedAt: beforeNow,
        completedAt: now,
        outcome: "success" as const,
        manifest: incomplete,
      },
    };
    const context: DocumentValidationContext = {
      ...emptyContext(),
      artifactRecords: allArtifactRecords(),
      snapshots: [scrubbedSnapshot],
      renderManifests: [incomplete],
      resumeRecord: resumeRecord("qa_passed"),
    };
    const result = await validateDocumentReadResult(
      "docx_render_pages",
      request,
      output,
      context,
    );
    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("RENDER_RESULT_INVALID");
  });

  it("re-derives QA instead of trusting a forged overall pass or partial page review", async () => {
    const fixture = await exportFixture();
    expect((await validateDocumentWriteRequest("artifact_export", fixture.request, fixture.context)).success).toBe(true);

    const forgedRequest = structuredClone(fixture.request) as Omit<
      typeof fixture.request,
      "qaReport"
    > & {
      qaReport: Omit<typeof fixture.request.qaReport, "checks"> & {
        checks: Array<
          Omit<(typeof fixture.request.qaReport.checks)[number], "status"> & {
            status: "passed" | "failed" | "blocked";
          }
        >;
      };
    };
    forgedRequest.qaReport.checks[0]!.status = "failed";
    forgedRequest.qaReport.pageInspections = [forgedRequest.qaReport.pageInspections[0]!];
    forgedRequest.authorization.actionFingerprint = await computeDocumentActionFingerprint(
      "artifact_export",
      forgedRequest,
    );
    const forgedContext = structuredClone(fixture.context);
    forgedContext.qaReports = [structuredClone(forgedRequest.qaReport)];
    forgedContext.authorizationRecord = await trustedExportRecord(forgedRequest.authorization);
    const result = await validateDocumentWriteRequest(
      "artifact_export",
      forgedRequest,
      forgedContext,
    );
    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("EXPORT_QA_MISMATCH");
  });

  it("rejects privacy outputs that alter semantic text or retain forbidden residue", async () => {
    const fixture = await privacyFixture();
    expect((await validateDocumentWriteRequest("docx_privacy_scrub", fixture.request, fixture.context)).success).toBe(true);
    const valid = await validateDocumentWriteResult(
      "docx_privacy_scrub",
      fixture.request,
      fixture.output,
      fixture.resultContext,
    );
    expect(valid.issues).toEqual([]);

    const changedTextOutput = structuredClone(fixture.output);
    changedTextOutput.result.report.semanticTextHashAfter = hash(98);
    const changedTextContext = structuredClone(fixture.resultContext);
    changedTextContext.privacyReports = [structuredClone(changedTextOutput.result.report)];
    const changedText = await validateDocumentWriteResult(
      "docx_privacy_scrub",
      fixture.request,
      changedTextOutput,
      changedTextContext,
    );
    expect(changedText.issues.map((issue) => issue.code)).toContain("SCRUB_RESULT_INVALID");

    const residueOutput = structuredClone(fixture.output);
    residueOutput.result.report.remaining.comments = 1;
    const residueContext = structuredClone(fixture.resultContext);
    residueContext.privacyReports = [structuredClone(residueOutput.result.report)];
    const residue = await validateDocumentWriteResult(
      "docx_privacy_scrub",
      fixture.request,
      residueOutput,
      residueContext,
    );
    expect(residue.issues.map((issue) => issue.code)).toContain("SCRUB_RESULT_INVALID");
  });

  it("exports only the exact QA-approved bytes under a new immutable ID", async () => {
    const fixture = await exportFixture();
    const approvalHash = await sha256(canonicalize(fixture.request.contentApproval));
    const exportedDocument = {
      artifactId: "artifact:exported",
      kind: "document_export" as const,
      fileName: "tailored-resume.docx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
      contentHash: scrubbedDocument.contentHash,
      byteSize: scrubbedDocument.byteSize,
    };
    const manifest = {
      manifestId: "export-manifest:1",
      operationId: "operation:export",
      resumeVersionId: "resume:1",
      profileId: "profile:1",
      sourceDocument: scrubbedDocument,
      exportedDocument,
      contentApprovalId: "content-approval:1",
      contentApprovalHash: approvalHash,
      buildManifestHash: hash(57),
      privacyReportHash: hash(68),
      renderSetHash: hash(62),
      qaReportHash: hash(69),
      format: "docx" as const,
      destination: "user_download" as const,
      exactBytePromotion: true as const,
      manifestArtifact: exportManifestArtifact,
      exportedAt: beforeNow,
      manifestHash: hash(75),
    };
    const authorizationRecord = fixture.context.authorizationRecord!;
    const receipt = { ...authorizationRecord } as Record<string, unknown>;
    delete receipt.status;
    delete receipt.reservedAt;
    const output = {
      result: {
        contractVersion: "1.0.0" as const,
        requestId: fixture.request.requestId,
        operationId: fixture.request.operationId,
        profileId: fixture.request.profileId,
        tool: "artifact_export" as const,
        startedAt: beforeNow,
        completedAt: now,
        outcome: "verified_created" as const,
        actionFingerprint: fixture.request.authorization.actionFingerprint,
        authorizationReceipt: receipt,
        exportedDocument,
        manifest,
        evidenceArtifactIds: ["artifact:export-manifest"],
      },
    };
    const resultContext: DocumentValidationContext = {
      ...fixture.context,
      artifactRecords: [
        ...fixture.context.artifactRecords,
        trustedArtifact(exportedDocument, exportedDocument.contentHash, {
          creatingOperationId: "operation:export",
          resumeVersionId: "resume:1",
        }),
      ],
      exportManifests: [manifest],
    };
    const valid = await validateDocumentWriteResult(
      "artifact_export",
      fixture.request,
      output,
      resultContext,
    );
    expect(valid.issues).toEqual([]);

    const substituted = structuredClone(output);
    substituted.result.exportedDocument.contentHash = hash(97);
    substituted.result.manifest.exportedDocument.contentHash = hash(97);
    const substitutedContext = structuredClone(resultContext);
    substitutedContext.artifactRecords = substitutedContext.artifactRecords.filter(
      (record) => record.artifactId !== "artifact:exported",
    );
    substitutedContext.artifactRecords.push(
      trustedArtifact(
        substituted.result.exportedDocument,
        substituted.result.exportedDocument.contentHash,
        { creatingOperationId: "operation:export", resumeVersionId: "resume:1" },
      ),
    );
    substitutedContext.exportManifests = [structuredClone(substituted.result.manifest)];
    const result = await validateDocumentWriteResult(
      "artifact_export",
      fixture.request,
      substituted,
      substitutedContext,
    );
    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("EXPORT_RESULT_SUBSTITUTION");
  });

  it("keeps trusted context out of the executor and settles the exact reservation in finally", async () => {
    const fixture = await privacyFixture();
    const executorCalls: unknown[][] = [];
    const settlements: Array<Record<string, unknown>> = [];
    const handler = createValidatedDocumentMcpWriteHandler("docx_privacy_scrub", {
      reserveTrustedExecutionContext: async () => fixture.context,
      executeValidatedWrite: async (...args: unknown[]) => {
        executorCalls.push(args);
        return fixture.output;
      },
      loadTrustedResultContext: async () => fixture.resultContext,
      settleTrustedExecution: async (settlement) => {
        settlements.push(settlement);
      },
    });

    await expect(handler(fixture.request)).resolves.toEqual(fixture.output);
    expect(executorCalls).toHaveLength(1);
    expect(executorCalls[0]).toHaveLength(2);
    expect(executorCalls[0]?.[0]).toBe("docx_privacy_scrub");
    expect(executorCalls[0]?.[1]).not.toHaveProperty("artifactRecords");
    expect(executorCalls[0]?.[1]).not.toHaveProperty("authorizationRecord");
    expect(settlements).toEqual([
      {
        tool: "docx_privacy_scrub",
        operationId: fixture.context.authorizationRecord!.operationId,
        actionFingerprint: fixture.context.authorizationRecord!.actionFingerprint,
        executionReservationId:
          fixture.context.authorizationRecord!.executionReservationId,
        disposition: "verified_created",
      },
    ]);

    const failureSettlements: Array<Record<string, unknown>> = [];
    const failingHandler = createValidatedDocumentMcpWriteHandler("docx_privacy_scrub", {
      reserveTrustedExecutionContext: async () => fixture.context,
      executeValidatedWrite: async () => {
        throw new Error("worker crashed after reservation");
      },
      loadTrustedResultContext: async () => fixture.resultContext,
      settleTrustedExecution: async (settlement) => {
        failureSettlements.push(settlement);
      },
    });
    await expect(failingHandler(fixture.request)).rejects.toThrow("worker crashed");
    expect(failureSettlements).toEqual([
      expect.objectContaining({
        executionReservationId:
          fixture.context.authorizationRecord!.executionReservationId,
        disposition: "uncertain",
      }),
    ]);
  });

  it("strictly parses structured output and export input", () => {
    expect(ArtifactExportInputSchema.safeParse({}).success).toBe(false);
    expect(() =>
      parseDocumentMcpStructuredContent("docx_parse", {
        result: {
          contractVersion: "1.0.0",
          requestId: "request:parse",
          operationId: "parse",
          profileId: "profile:1",
          tool: "docx_parse",
          startedAt: beforeNow,
          completedAt: now,
          outcome: "blocked",
          error: { code: "BLOCKED", message: "blocked", redacted: true },
          evidenceArtifactIds: [],
          unknown: true,
        },
      }),
    ).toThrow();
  });
});
