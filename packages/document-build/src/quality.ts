import {
  DocumentRenderEvidenceSchema,
  type DocumentBuildCheck,
  type DocumentBuildGate,
  type DocumentRenderEvidence,
  type DocumentRenderedPageEvidence,
  type ResumeDocumentBuild,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import { readZip } from "./zip.js";

export const QUALITY_VERIFIER_VERSION = "document-quality-v1";

export const REQUIRED_DOCUMENT_GATE_KINDS = [
  "package_safety",
  "privacy_metadata",
  "structure",
  "page_render",
  "visual_regression",
] as const;

const REQUIRED_PARTS = new Set([
  "[Content_Types].xml",
  "_rels/.rels",
  "word/_rels/document.xml.rels",
  "word/document.xml",
  "word/styles.xml",
  "word/numbering.xml",
  "word/settings.xml",
]);

const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
const MAX_PART_BYTES = 2 * 1024 * 1024;
const decoder = new TextDecoder();

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function gate(
  kind: DocumentBuildGate["kind"],
  status: DocumentBuildGate["status"],
  detail: string,
  evidenceHash?: string,
): DocumentBuildGate {
  return { kind, status, detail, ...(evidenceHash === undefined ? {} : { evidenceHash }) };
}

function joinedDetail(prefix: string, findings: readonly string[]): string {
  return `${prefix} ${findings.join(" ")}`.slice(0, 2_000);
}

export interface PackageQualityResult {
  gates: DocumentBuildGate[];
  failures: DocumentBuildCheck[];
}

/** Audit package safety, metadata/privacy residue, and template structure from the bytes. */
export function auditDocumentPackage(bytes: Uint8Array): PackageQualityResult {
  const packageFindings: string[] = [];
  const privacyFindings: string[] = [];
  const structureFindings: string[] = [];

  if (bytes.byteLength > MAX_PACKAGE_BYTES) packageFindings.push("The package exceeds the 8 MiB build limit.");

  let entries: Map<string, Uint8Array>;
  try {
    entries = readZip(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The OOXML ZIP package could not be inspected.";
    return {
      gates: [
        gate("package_safety", "failed", detail),
        gate("privacy_metadata", "blocked", "Privacy inspection was blocked by an unreadable package."),
        gate("structure", "blocked", "Structural inspection was blocked by an unreadable package."),
      ],
      failures: [
        { code: "package_safety_failed", detail },
        { code: "privacy_metadata_failed", detail: "Privacy inspection could not complete." },
        { code: "structure_failed", detail: "Structural inspection could not complete." },
      ],
    };
  }

  const names = [...entries.keys()];
  const unexpectedParts = names.filter((name) => !REQUIRED_PARTS.has(name));
  const missingParts = [...REQUIRED_PARTS].filter((name) => !entries.has(name));
  if (unexpectedParts.length > 0) packageFindings.push(`Unexpected package parts: ${unexpectedParts.join(", ")}.`);
  if (missingParts.length > 0) structureFindings.push(`Required package parts are missing: ${missingParts.join(", ")}.`);
  for (const [name, data] of entries) {
    if (data.byteLength > MAX_PART_BYTES) packageFindings.push(`Part ${name} exceeds the 2 MiB part limit.`);
  }

  const xml = new Map(
    [...entries]
      .filter(([name]) => name.endsWith(".xml") || name.endsWith(".rels"))
      .map(([name, data]) => [name, decoder.decode(data)]),
  );
  const allXml = [...xml.values()].join("\n");

  const unsafePackagePatterns: Array<[RegExp, string]> = [
    [/TargetMode\s*=\s*["']External["']/i, "external relationships"],
    [/vbaProject|macroEnabled|activeX|oleObject|embeddedPackage|altChunk/i, "active content or embedded packages"],
    [/<w:(?:fldSimple|instrText)\b/i, "field-code instructions"],
  ];
  for (const [pattern, label] of unsafePackagePatterns) {
    if (pattern.test(allXml)) packageFindings.push(`The package contains ${label}.`);
  }

  const privacyPart = names.find((name) =>
    /^(?:docProps\/|customXml\/|word\/comments|word\/people|word\/revision|word\/embeddings\/|docProps\/thumbnail)/i.test(name),
  );
  if (privacyPart) privacyFindings.push(`Forbidden metadata or review part remains: ${privacyPart}.`);

  const privacyPatterns: Array<[RegExp, string]> = [
    [/<w:(?:ins|del|moveFrom|moveTo)\b/i, "tracked changes"],
    [/<w:comment(?:RangeStart|RangeEnd|Reference)?\b/i, "comments"],
    [/<w:(?:vanish|webHidden)\b/i, "hidden text"],
    [/<w:(?:docVars|docVar|customXml)\b/i, "document variables or custom XML"],
    [/\sw:rsid(?:R|RPr|Del|P|Sect)?\s*=/i, "revision identifiers"],
  ];
  for (const [pattern, label] of privacyPatterns) {
    if (pattern.test(allXml)) privacyFindings.push(`The document contains ${label}.`);
  }

  const documentXml = xml.get("word/document.xml") ?? "";
  const stylesXml = xml.get("word/styles.xml") ?? "";
  const numberingXml = xml.get("word/numbering.xml") ?? "";
  const rootRels = xml.get("_rels/.rels") ?? "";
  const documentRels = xml.get("word/_rels/document.xml.rels") ?? "";
  const contentTypes = xml.get("[Content_Types].xml") ?? "";

  if (!/^<\?xml[^>]*>\s*<w:document\b[\s\S]*<w:body>[\s\S]*<\/w:body>\s*<\/w:document>\s*$/.test(documentXml)) {
    structureFindings.push("word/document.xml does not have the expected document/body structure.");
  }
  if ((documentXml.match(/<w:sectPr>/g) ?? []).length !== 1) {
    structureFindings.push("The document must contain exactly one section-properties block.");
  }
  if (/<w:(?:tbl|drawing|pict|txbxContent|object|subDoc)\b/i.test(documentXml)) {
    structureFindings.push("Tables, drawings, text boxes, and embedded document objects are not allowed in the ATS template.");
  }

  const allowedStyles = new Set([
    "ResumeName",
    "ResumeContact",
    "ResumeSection",
    "ResumeEntryHeading",
    "ResumeEntryMeta",
    "ResumeBullet",
    "ResumeLine",
  ]);
  const usedStyles = [...documentXml.matchAll(/<w:pStyle w:val="([^"]+)"\/>/g)].map((match) => match[1] ?? "");
  if (usedStyles.length === 0 || usedStyles.some((style) => !allowedStyles.has(style))) {
    structureFindings.push("The document uses a missing or unsupported paragraph style.");
  }
  const bulletParagraphs = [...documentXml.matchAll(/<w:p><w:pPr><w:pStyle w:val="ResumeBullet"\/>([\s\S]*?)<\/w:pPr>/g)];
  if (bulletParagraphs.some((match) => !/<w:numId w:val="1"\/>/.test(match[1] ?? ""))) {
    structureFindings.push("A resume bullet is not bound to the template's Word numbering definition.");
  }
  if (!stylesXml.includes('w:lang w:val="en-US"') || !numberingXml.includes('<w:numFmt w:val="bullet"/>')) {
    structureFindings.push("The template language or numbering definition is missing.");
  }
  if (
    !rootRels.includes('Target="word/document.xml"') ||
    !documentRels.includes('Target="styles.xml"') ||
    !documentRels.includes('Target="numbering.xml"') ||
    !documentRels.includes('Target="settings.xml"') ||
    !contentTypes.includes('PartName="/word/document.xml"')
  ) {
    structureFindings.push("OOXML content types or relationships do not point to the required internal parts.");
  }

  const packageEvidenceHash = sha256(JSON.stringify({ names, packageFindings }));
  const privacyEvidenceHash = sha256(JSON.stringify({ names, privacyFindings }));
  const structureEvidenceHash = sha256(JSON.stringify({ names, structureFindings, usedStyles }));
  const gates = [
    gate(
      "package_safety",
      packageFindings.length === 0 ? "passed" : "failed",
      packageFindings.length === 0 ? "Canonical ZIP and OOXML package safety checks passed." : joinedDetail("Package safety failed.", packageFindings),
      packageEvidenceHash,
    ),
    gate(
      "privacy_metadata",
      privacyFindings.length === 0 ? "passed" : "failed",
      privacyFindings.length === 0 ? "No metadata, review history, hidden text, or external privacy residue was found." : joinedDetail("Privacy audit failed.", privacyFindings),
      privacyEvidenceHash,
    ),
    gate(
      "structure",
      structureFindings.length === 0 ? "passed" : "failed",
      structureFindings.length === 0 ? "Required ATS-safe parts, relationships, styles, numbering, and page structure are intact." : joinedDetail("Structural audit failed.", structureFindings),
      structureEvidenceHash,
    ),
  ];
  const failures: DocumentBuildCheck[] = [];
  if (packageFindings.length > 0) failures.push({ code: "package_safety_failed", detail: joinedDetail("Package safety failed.", packageFindings) });
  if (privacyFindings.length > 0) failures.push({ code: "privacy_metadata_failed", detail: joinedDetail("Privacy audit failed.", privacyFindings) });
  if (structureFindings.length > 0) failures.push({ code: "structure_failed", detail: joinedDetail("Structural audit failed.", structureFindings) });
  return { gates, failures };
}

export function computeVisualBaselineHash(build: ResumeDocumentBuild): string {
  return sha256(JSON.stringify([build.templateId, build.templateVersion, build.templateHash]));
}

export function computeVisualComparisonHash(
  visualBaselineHash: string,
  pages: readonly DocumentRenderedPageEvidence[],
): string {
  return sha256(
    JSON.stringify([
      visualBaselineHash,
      pages.map((page) => [page.pageNumber, page.imageHash, page.widthPixels, page.heightPixels, page.dpi]),
    ]),
  );
}

export function computeDocumentRenderEvidenceHash(
  evidence: Omit<DocumentRenderEvidence, "evidenceHash">,
): string {
  return sha256(JSON.stringify(evidence));
}

export interface RenderQualityResult {
  gates: DocumentBuildGate[];
  failures: DocumentBuildCheck[];
  renderEvidenceHash?: string;
}

/** Validate trusted render evidence and a 100% visual inspection for every rendered page. */
export function verifyDocumentRenderEvidence(
  build: ResumeDocumentBuild,
  bytes: Uint8Array,
  evidence: DocumentRenderEvidence | undefined,
): RenderQualityResult {
  if (!evidence) {
    return {
      gates: [
        gate("page_render", "blocked", "No trusted page-render evidence was supplied for these exact document bytes."),
        gate("visual_regression", "blocked", "Visual inspection cannot run until every page has trusted render evidence."),
      ],
      failures: [{ code: "render_evidence_missing", detail: "The document has no trusted page-render and visual-inspection evidence." }],
    };
  }

  const parsed = DocumentRenderEvidenceSchema.safeParse(evidence);
  if (!parsed.success) {
    return {
      gates: [
        gate("page_render", "failed", "The render evidence does not satisfy its contract."),
        gate("visual_regression", "blocked", "Visual inspection evidence is invalid."),
      ],
      failures: [{ code: "render_evidence_mismatch", detail: "The render evidence does not satisfy its contract." }],
    };
  }

  const value = parsed.data;
  const { evidenceHash: claimedEvidenceHash, ...hashInput } = value;
  const expectedEvidenceHash = computeDocumentRenderEvidenceHash(hashInput);
  const expectedBaselineHash = computeVisualBaselineHash(build);
  const expectedComparisonHash = computeVisualComparisonHash(value.visualBaselineHash, value.pages);
  const pageNumbersAreContinuous = value.pages.every((page, index) => page.pageNumber === index + 1);
  const firstPage = value.pages[0];
  const dimensionsAreConsistent = value.pages.every(
    (page) =>
      page.widthPixels === firstPage?.widthPixels &&
      page.heightPixels === firstPage.heightPixels &&
      page.dpi === firstPage.dpi,
  );
  const renderMatches =
    value.buildId === build.id &&
    value.outputHash === build.outputHash &&
    value.outputHash === sha256(bytes) &&
    value.templateHash === build.templateHash &&
    value.pageCount === value.pages.length &&
    pageNumbersAreContinuous &&
    dimensionsAreConsistent &&
    value.visualBaselineHash === expectedBaselineHash &&
    value.visualComparisonHash === expectedComparisonHash &&
    claimedEvidenceHash === expectedEvidenceHash;

  if (!renderMatches) {
    return {
      gates: [
        gate("page_render", "failed", "Render evidence is incomplete, altered, or bound to different document bytes."),
        gate("visual_regression", "blocked", "Visual evidence cannot be trusted because its render binding failed."),
      ],
      failures: [{ code: "render_evidence_mismatch", detail: "Render evidence is incomplete, altered, or bound to different document bytes." }],
    };
  }

  const visualDefects = value.pages.filter(
    (page) =>
      page.clipping ||
      page.overlap ||
      page.missingGlyph ||
      page.fontFallback ||
      page.bulletMisalignment ||
      page.unexpectedPageBreak ||
      page.unexpectedBlankPage,
  );
  const visualPassed = value.visualRegressionPassed && visualDefects.length === 0;
  return {
    gates: [
      gate("page_render", "passed", `Rendered and hash-bound all ${value.pageCount} document page(s).`, claimedEvidenceHash),
      gate(
        "visual_regression",
        visualPassed ? "passed" : "failed",
        visualPassed
          ? "Every rendered page passed the baseline and full-page visual defect inspection."
          : `Visual inspection found defects on ${visualDefects.length} page(s), or the baseline comparison failed.`,
        value.visualComparisonHash,
      ),
    ],
    failures: visualPassed
      ? []
      : [{ code: "visual_quality_failed", detail: "The rendered pages did not pass full-page visual regression inspection." }],
    renderEvidenceHash: claimedEvidenceHash,
  };
}

/** Old or partial reports are intentionally not sufficient for download. */
export function documentBuildReportPassesDownloadGate(report: {
  passed: boolean;
  failures: readonly unknown[];
  qualityGates?: readonly DocumentBuildGate[] | undefined;
  renderEvidenceHash?: string | undefined;
  renderEvidence?: DocumentRenderEvidence | undefined;
} | null | undefined): boolean {
  if (
    !report?.passed ||
    report.failures.length > 0 ||
    report.qualityGates?.length !== REQUIRED_DOCUMENT_GATE_KINDS.length ||
    !report.renderEvidenceHash ||
    report.renderEvidence?.evidenceHash !== report.renderEvidenceHash
  ) {
    return false;
  }
  const byKind = new Map(report.qualityGates.map((entry) => [entry.kind, entry]));
  return REQUIRED_DOCUMENT_GATE_KINDS.every((kind) => byKind.get(kind)?.status === "passed");
}
