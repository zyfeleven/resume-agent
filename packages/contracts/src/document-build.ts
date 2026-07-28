import { z } from "zod";

import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "./common.js";

/**
 * A resume document generated from an approved change set, with no template involved.
 *
 * This is deliberately narrower than `DocumentBuildManifest`, which records editing an
 * existing DOCX template in place and therefore binds a source document, an inspection
 * profile, and block-level operations. None of those exist for a document written from
 * scratch, and a manifest may not be filled with values that were never observed.
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
  "unapproved_text_in_document",
]);

export const DocumentBuildCheckSchema = z
  .object({
    code: DocumentBuildCheckCodeSchema,
    detail: z.string().min(1).max(2_000),
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
  })
  .strict();

export type ResumeDocumentBlock = z.infer<typeof ResumeDocumentBlockSchema>;
export type ResumeDocumentBuild = z.infer<typeof ResumeDocumentBuildSchema>;
export type DocumentBuildCheckCode = z.infer<typeof DocumentBuildCheckCodeSchema>;
export type DocumentBuildCheck = z.infer<typeof DocumentBuildCheckSchema>;
export type DocumentBuildReport = z.infer<typeof DocumentBuildReportSchema>;
