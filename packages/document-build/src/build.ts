import {
  DocumentBuildReportSchema,
  DocumentRenderEvidenceSchema,
  ResumeDocumentBuildSchema,
  type DocumentBuildCheck,
  type DocumentBuildReport,
  type DocumentRenderEvidence,
  type Fact,
  type ResumeContentApproval,
  type ResumeChangeSet,
  type ResumeDocumentBuild,
  type ResumeIR,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import {
  BUILDER_NAME,
  BUILDER_VERSION,
  buildResumeDocx,
  extractDocxText,
  hasClassicTemplateFingerprint,
} from "./docx.js";
import { resolveResumeTemplate } from "./template.js";
import { auditDocumentPackage, verifyDocumentRenderEvidence } from "./quality.js";

export const VERIFIER_VERSION = "document-build-verify-v2";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface BuildResumeDocumentInput {
  resumeVersionId: string;
  profileId: string;
  jobId?: string;
  templateId: string;
  resume: ResumeIR;
  facts: readonly Fact[];
  changeSet: ResumeChangeSet;
  approval: ResumeContentApproval;
  builtAt: string;
}

export interface BuildResumeDocumentResult {
  build: ResumeDocumentBuild;
  bytes: Uint8Array;
  text: string;
}

/**
 * Write the approved resume to a `.docx` and record what was written.
 *
 * The build is bound to the approval it came from: the approved content hash, the change
 * set, and the verified-fact snapshot all travel with the output, so a document can
 * always be traced back to the exact content a person approved.
 */
export function buildResumeDocument(input: BuildResumeDocumentInput): BuildResumeDocumentResult {
  const document = buildResumeDocx(input.resume, input.facts, input.templateId);
  const expectedPresentationHash = sha256(
    JSON.stringify([document.templateId, input.approval.approvedContentHash]),
  );
  if (input.approval.approvedPresentationHash !== expectedPresentationHash) {
    throw new Error("The content approval is not bound to this resume template.");
  }
  const buildIdentity = sha256(JSON.stringify([input.approval.id, document.contentHash]));

  const build = ResumeDocumentBuildSchema.parse({
    id: `document-build:${buildIdentity.slice(0, 24)}`,
    resumeVersionId: input.resumeVersionId,
    profileId: input.profileId,
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
    changeSetId: input.changeSet.id,
    changeSetHash: input.changeSet.contentHash,
    factSnapshotHash: input.changeSet.factSnapshotHash,
    contentApprovalId: input.approval.id,
    approvedContentHash: input.approval.approvedContentHash,
    templateId: document.templateId,
    templateVersion: document.templateVersion,
    templateHash: document.templateHash,
    builderName: BUILDER_NAME,
    builderVersion: BUILDER_VERSION,
    outputArtifactId: `artifact:${document.contentHash.slice(0, 24)}`,
    outputHash: document.contentHash,
    outputByteSize: document.bytes.byteLength,
    documentTextHash: document.documentTextHash,
    blocks: document.blocks,
    builtAt: input.builtAt,
  });

  return { build, bytes: document.bytes, text: document.text };
}

export interface VerifyDocumentBuildInput {
  build: ResumeDocumentBuild;
  bytes: Uint8Array;
  resume: ResumeIR;
  facts: readonly Fact[];
  changeSet: ResumeChangeSet;
  approval: ResumeContentApproval;
  /** Evidence must come from the trusted renderer boundary, never from browser input. */
  renderEvidence?: DocumentRenderEvidence;
  checkedAt: string;
}

/**
 * Check a built document against the content that was approved.
 *
 * Every check re-reads the bytes on disk rather than trusting the build record, so a
 * document that was altered after it was written, or that says something the approved
 * resume does not, fails here instead of reaching an application.
 */
export function verifyDocumentBuild(input: VerifyDocumentBuildInput): DocumentBuildReport {
  const failures: DocumentBuildCheck[] = [];
  const { build } = input;
  const packageQuality = auditDocumentPackage(input.bytes);
  const renderQuality = verifyDocumentRenderEvidence(build, input.bytes, input.renderEvidence);
  const storedRenderEvidence = DocumentRenderEvidenceSchema.safeParse(input.renderEvidence).data;
  failures.push(...packageQuality.failures, ...renderQuality.failures);
  const qualityGates = [...packageQuality.gates, ...renderQuality.gates];

  if (build.outputHash !== sha256(input.bytes)) {
    failures.push({
      code: "output_hash_mismatch",
      detail: "The stored document bytes do not match the hash recorded when it was built.",
    });
  }

  try {
    const template = resolveResumeTemplate(build.templateId);
    if (
      build.templateVersion !== template.version ||
      build.templateHash !== template.hash ||
      input.approval.approvedPresentationHash !==
        sha256(JSON.stringify([template.id, input.approval.approvedContentHash])) ||
      !hasClassicTemplateFingerprint(input.bytes)
    ) {
      failures.push({
        code: "template_mismatch",
        detail: "The document does not preserve the versioned styles, numbering, or page geometry of its template.",
      });
    }
  } catch {
    failures.push({
      code: "template_mismatch",
      detail: "The build cites a resume template that is not available in this release.",
    });
  }

  const actualContentHash = sha256(JSON.stringify(input.resume));
  if (
    build.approvedContentHash !== input.approval.approvedContentHash ||
    build.approvedContentHash !== actualContentHash ||
    build.contentApprovalId !== input.approval.id ||
    build.resumeVersionId !== input.approval.resumeVersionId ||
    build.profileId !== input.approval.profileId ||
    build.profileId !== input.resume.profileId
  ) {
    failures.push({
      code: "approval_content_mismatch",
      detail: "This document was built from different approved content than the approval it cites.",
    });
  }

  if (
    build.changeSetId !== input.changeSet.id ||
    build.changeSetHash !== input.changeSet.contentHash ||
    input.approval.changeSetId !== input.changeSet.id ||
    input.approval.changeSetHash !== input.changeSet.contentHash ||
    build.jobId !== input.changeSet.jobId ||
    input.approval.jobId !== input.changeSet.jobId
  ) {
    failures.push({
      code: "change_set_mismatch",
      detail: "This document cites a change set other than the one it was built from.",
    });
  }

  const verifiedFactIds = new Set(
    input.facts
      .filter((fact) => fact.status === "verified" && fact.profileId === build.profileId)
      .map((fact) => fact.id),
  );
  for (const block of build.blocks) {
    if (!block.factIds.every((factId) => verifiedFactIds.has(factId))) {
      failures.push({
        code: "block_not_fact_backed",
        detail: `Block ${block.blockId} cites a fact that is not a verified fact of this profile.`,
      });
    }
  }

  let documentText: string;
  try {
    documentText = extractDocxText(input.bytes);
  } catch (error) {
    failures.push({
      code: "document_text_mismatch",
      detail: error instanceof Error ? error.message : "The document could not be read back.",
    });
    return DocumentBuildReportSchema.parse({
      buildId: build.id,
      verifierVersion: VERIFIER_VERSION,
      checkedAt: input.checkedAt,
      passed: false,
      failures,
      qualityGates,
      ...(renderQuality.renderEvidenceHash === undefined
        ? {}
        : { renderEvidenceHash: renderQuality.renderEvidenceHash }),
      ...(storedRenderEvidence === undefined ? {} : { renderEvidence: storedRenderEvidence }),
    });
  }

  if (sha256(documentText) !== build.documentTextHash) {
    failures.push({
      code: "document_text_mismatch",
      detail: "The document's text does not match the text recorded when it was built.",
    });
  }

  const documentLines = documentText.split("\n");
  // Real Word numbering is presentation metadata, so extracted paragraph text is the
  // approved content itself and never includes a fake Unicode bullet prefix.
  const expectedLine = (block: ResumeDocumentBuild["blocks"][number]): string => block.text;

  for (const block of build.blocks) {
    if (!documentLines.includes(expectedLine(block))) {
      failures.push({
        code: "block_text_not_in_document",
        detail: `Block ${block.blockId} is recorded in the build but its text is not in the document.`,
      });
    }
  }

  // Nothing may appear in the document that no block accounts for.
  const remainingExpectedLines = new Map<string, number>();
  for (const block of build.blocks) {
    const line = expectedLine(block);
    remainingExpectedLines.set(line, (remainingExpectedLines.get(line) ?? 0) + 1);
  }
  for (const line of documentLines) {
    const remaining = remainingExpectedLines.get(line) ?? 0;
    if (remaining === 0) {
      failures.push({
        code: "unapproved_text_in_document",
        detail: "The document contains a line that no recorded block accounts for.",
      });
      break;
    }
    remainingExpectedLines.set(line, remaining - 1);
  }

  return DocumentBuildReportSchema.parse({
    buildId: build.id,
    verifierVersion: VERIFIER_VERSION,
    checkedAt: input.checkedAt,
    passed: failures.length === 0,
    failures,
    qualityGates,
    ...(renderQuality.renderEvidenceHash === undefined
      ? {}
      : { renderEvidenceHash: renderQuality.renderEvidenceHash }),
    ...(storedRenderEvidence === undefined ? {} : { renderEvidence: storedRenderEvidence }),
  });
}
