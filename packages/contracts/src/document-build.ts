import { z } from "zod";

import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "./common.js";

/**
 * A resume document generated from an approved change set inside a versioned template.
 *
 * This is deliberately narrower than `DocumentBuildManifest`, which records editing an
 * user-supplied DOCX template in place and therefore binds a source document, an inspection
 * profile, and block-level operations. This narrower path applies approved content to a
 * built-in immutable template and records its ID, version, and fingerprint directly.
 */
export const ResumeDocumentBlockSchema = z
  .object({
    blockId: EntityIdSchema,
    section: z.enum(["header", "summary", "experience", "skills", "projects", "education"]),
    style: z.enum(["name", "contact", "heading", "entry_heading", "entry_meta", "bullet", "line"]),
    text: z.string().min(1).max(20_000),
    textHash: Sha256Schema,
    factIds: z.array(EntityIdSchema).min(1).max(100),
    contentItemId: EntityIdSchema.optional(),
  })
  .strict()
  .meta({
    description:
      "One paragraph of the generated document. Every block cites the verified facts its text came from, so no line of the output is unattributable.",
  });

export const ResumeDocumentBuildSchema = z
  .object({
    id: EntityIdSchema,
    resumeVersionId: EntityIdSchema,
    profileId: EntityIdSchema,
    jobId: EntityIdSchema.optional(),
    changeSetId: EntityIdSchema,
    changeSetHash: Sha256Schema,
    factSnapshotHash: Sha256Schema,
    contentApprovalId: EntityIdSchema,
    approvedContentHash: Sha256Schema,
    templateId: EntityIdSchema,
    templateVersion: z.string().min(1).max(160).optional(),
    templateHash: Sha256Schema.optional(),
    builderName: z.string().min(1).max(160),
    builderVersion: z.string().min(1).max(160),
    outputArtifactId: EntityIdSchema,
    /** SHA-256 of the exact `.docx` bytes written. */
    outputHash: Sha256Schema,
    outputByteSize: z.number().int().positive(),
    /** SHA-256 of the document's extracted text, so content can be compared without the bytes. */
    documentTextHash: Sha256Schema,
    blocks: z.array(ResumeDocumentBlockSchema).min(1).max(10_000),
    builtAt: IsoDateTimeSchema,
  })
  .strict();

export const DocumentBuildCheckCodeSchema = z.enum([
  "approval_content_mismatch",
  "change_set_mismatch",
  "block_not_fact_backed",
  "block_text_not_in_document",
  "document_text_mismatch",
  "output_hash_mismatch",
  "template_mismatch",
  "unapproved_text_in_document",
  "package_safety_failed",
  "privacy_metadata_failed",
  "structure_failed",
  "render_evidence_missing",
  "render_evidence_mismatch",
  "visual_quality_failed",
]);

export const DocumentBuildCheckSchema = z
  .object({
    code: DocumentBuildCheckCodeSchema,
    detail: z.string().min(1).max(2_000),
  })
  .strict();

export const DocumentBuildGateKindSchema = z.enum([
  "package_safety",
  "privacy_metadata",
  "structure",
  "page_render",
  "visual_regression",
]);

export const DocumentBuildGateSchema = z
  .object({
    kind: DocumentBuildGateKindSchema,
    status: z.enum(["passed", "failed", "blocked"]),
    detail: z.string().min(1).max(2_000),
    evidenceHash: Sha256Schema.optional(),
  })
  .strict();

export const DocumentRenderedPageEvidenceSchema = z
  .object({
    pageNumber: z.number().int().positive().max(100),
    imageHash: Sha256Schema,
    widthPixels: z.number().int().positive().max(20_000),
    heightPixels: z.number().int().positive().max(20_000),
    dpi: z.number().int().min(72).max(600),
    inspectedAt: IsoDateTimeSchema,
    clipping: z.boolean(),
    overlap: z.boolean(),
    missingGlyph: z.boolean(),
    fontFallback: z.boolean(),
    bulletMisalignment: z.boolean(),
    unexpectedPageBreak: z.boolean(),
    unexpectedBlankPage: z.boolean(),
  })
  .strict();

/**
 * Evidence returned by a trusted renderer/visual-inspection worker. The verifier binds
 * it to the exact build bytes and recomputes `evidenceHash`, preventing evidence from a
 * different document or template from being replayed at the download boundary.
 */
export const DocumentRenderEvidenceSchema = z
  .object({
    buildId: EntityIdSchema,
    outputHash: Sha256Schema,
    templateHash: Sha256Schema,
    rendererName: z.string().min(1).max(160),
    rendererVersion: z.string().min(1).max(160),
    renderedAt: IsoDateTimeSchema,
    pageCount: z.number().int().positive().max(100),
    pages: z.array(DocumentRenderedPageEvidenceSchema).min(1).max(100),
    visualBaselineHash: Sha256Schema,
    visualComparisonHash: Sha256Schema,
    visualRegressionPassed: z.boolean(),
    evidenceHash: Sha256Schema,
  })
  .strict();

/**
 * Structural gate between building a document and letting anyone use it. It re-reads the
 * bytes that were written rather than trusting the builder's own report.
 */
export const DocumentBuildReportSchema = z
  .object({
    buildId: EntityIdSchema,
    verifierVersion: z.string().min(1).max(120),
    checkedAt: IsoDateTimeSchema,
    passed: z.boolean(),
    failures: z.array(DocumentBuildCheckSchema),
    /** Missing on pre-P2-06 records; download code treats absence as a hard failure. */
    qualityGates: z.array(DocumentBuildGateSchema).length(5).optional(),
    renderEvidenceHash: Sha256Schema.optional(),
    renderEvidence: DocumentRenderEvidenceSchema.optional(),
  })
  .strict();

export const ResumeArtifactGateEvidenceSchema = z
  .object({
    kind: DocumentBuildGateKindSchema,
    status: z.literal("passed"),
    evidenceHash: Sha256Schema,
  })
  .strict();

/**
 * Exact immutable inputs needed to reproduce and verify one downloadable DOCX.
 * The manifest contains hashes and IDs only; source content remains in its governed stores.
 */
export const ResumeArtifactManifestSchema = z
  .object({
    id: EntityIdSchema,
    manifestVersion: z.literal("resume-artifact-manifest-v1"),
    manifestArtifactId: EntityIdSchema,
    buildId: EntityIdSchema,
    outputArtifactId: EntityIdSchema,
    outputHash: Sha256Schema,
    outputByteSize: z.number().int().positive(),
    documentTextHash: Sha256Schema,
    resumeVersionId: EntityIdSchema,
    resumeContentHash: Sha256Schema,
    profileId: EntityIdSchema,
    jobId: EntityIdSchema.optional(),
    changeSetId: EntityIdSchema,
    changeSetHash: Sha256Schema,
    baseContentHash: Sha256Schema,
    resultContentHash: Sha256Schema,
    factSnapshotHash: Sha256Schema,
    requirementSnapshotHash: Sha256Schema.optional(),
    contentApprovalId: EntityIdSchema,
    contentApprovalHash: Sha256Schema,
    approvedPresentationHash: Sha256Schema,
    templateId: EntityIdSchema,
    templateVersion: z.string().min(1).max(160),
    templateHash: Sha256Schema,
    builderName: z.string().min(1).max(160),
    builderVersion: z.string().min(1).max(160),
    verifierVersion: z.string().min(1).max(160),
    buildReportHash: Sha256Schema,
    renderEvidenceHash: Sha256Schema,
    qualityGateEvidence: z.array(ResumeArtifactGateEvidenceSchema).length(5),
    reproductionHash: Sha256Schema,
    createdAt: IsoDateTimeSchema,
    manifestHash: Sha256Schema,
  })
  .strict();

export type ResumeDocumentBlock = z.infer<typeof ResumeDocumentBlockSchema>;
export type ResumeDocumentBuild = z.infer<typeof ResumeDocumentBuildSchema>;
export type DocumentBuildCheckCode = z.infer<typeof DocumentBuildCheckCodeSchema>;
export type DocumentBuildCheck = z.infer<typeof DocumentBuildCheckSchema>;
export type DocumentBuildGateKind = z.infer<typeof DocumentBuildGateKindSchema>;
export type DocumentBuildGate = z.infer<typeof DocumentBuildGateSchema>;
export type DocumentRenderedPageEvidence = z.infer<typeof DocumentRenderedPageEvidenceSchema>;
export type DocumentRenderEvidence = z.infer<typeof DocumentRenderEvidenceSchema>;
export type DocumentBuildReport = z.infer<typeof DocumentBuildReportSchema>;
export type ResumeArtifactGateEvidence = z.infer<typeof ResumeArtifactGateEvidenceSchema>;
export type ResumeArtifactManifest = z.infer<typeof ResumeArtifactManifestSchema>;
