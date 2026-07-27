import { z } from "zod";

import {
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from "./common.js";
import { FactKindSchema, FactSchema } from "./profile.js";

export const ResumeSourceFormatSchema = z.enum(["docx", "plain_text", "markdown"]);

export const ResumeSectionKindSchema = z.enum([
  "header",
  "summary",
  "skills",
  "experience",
  "education",
  "projects",
  "certifications",
  "work_authorization",
  "unrecognized",
]);

export const ResumeImportSkipReasonSchema = z.enum([
  "possible_secret",
  "duplicate_fact",
  "line_too_long",
  "unattached_bullet",
  "unrecognized_line",
]);

export const ResumeImportSourceSchema = z
  .object({
    artifactId: EntityIdSchema,
    fileName: z
      .string()
      .min(1)
      .max(500)
      .regex(/^(?!\.{1,2}$)[^/\\\u0000]+$/),
    format: ResumeSourceFormatSchema,
    contentHash: Sha256Schema,
    byteSize: z.number().int().positive(),
  })
  .strict();

export const ResumeImportRequestSchema = z
  .object({
    profileId: EntityIdSchema,
    source: ResumeImportSourceSchema,
    text: z
      .string()
      .min(1)
      .max(400_000)
      .meta({
        description:
          "Plain text already extracted from the source artifact by a trusted parser. The extractor never reads file paths, URLs, or raw bytes.",
      }),
    importedAt: IsoDateTimeSchema,
  })
  .strict();

export const ResumeImportSectionSchema = z
  .object({
    kind: ResumeSectionKindSchema,
    heading: z.string().min(1).max(160).optional(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .strict();

export const ResumeImportSkipSchema = z
  .object({
    line: z.number().int().positive(),
    reason: ResumeImportSkipReasonSchema,
  })
  .strict()
  .meta({
    description:
      "A source line that produced no fact. Skipped text is never copied into the report, so a suspected secret cannot leak through import telemetry.",
  });

export const ResumeImportFactCountSchema = z
  .object({
    kind: FactKindSchema,
    count: z.number().int().positive(),
  })
  .strict();

export const ResumeImportReportSchema = z
  .object({
    id: EntityIdSchema,
    profileId: EntityIdSchema,
    artifactId: EntityIdSchema,
    extractorVersion: z.string().min(1).max(120),
    importedAt: IsoDateTimeSchema,
    sourceLineCount: z.number().int().nonnegative(),
    sections: z.array(ResumeImportSectionSchema),
    factCounts: z.array(ResumeImportFactCountSchema),
    factIds: z.array(EntityIdSchema),
    skipped: z.array(ResumeImportSkipSchema),
  })
  .strict();

export const ResumeImportResultSchema = z
  .object({
    report: ResumeImportReportSchema,
    facts: z.array(FactSchema),
  })
  .strict();

/**
 * A single reviewer decision about a single extracted fact.
 *
 * `reviewedValueHash` binds the decision to the exact value the reviewer saw.
 * A fact whose value changed after the screen was rendered must be reviewed again.
 */
export const FactReviewDecisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("verify"),
      factId: EntityIdSchema,
      reviewedValueHash: Sha256Schema,
      verifiedBy: z.enum(["user", "trusted_source"]),
      decidedAt: IsoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      decision: z.literal("reject"),
      factId: EntityIdSchema,
      reviewedValueHash: Sha256Schema,
      rejectedBy: EntityIdSchema,
      reason: z.string().min(1).max(2_000),
      decidedAt: IsoDateTimeSchema,
    })
    .strict(),
]);

export type ResumeSourceFormat = z.infer<typeof ResumeSourceFormatSchema>;
export type ResumeSectionKind = z.infer<typeof ResumeSectionKindSchema>;
export type ResumeImportSkipReason = z.infer<typeof ResumeImportSkipReasonSchema>;
export type ResumeImportSource = z.infer<typeof ResumeImportSourceSchema>;
export type ResumeImportRequest = z.infer<typeof ResumeImportRequestSchema>;
export type ResumeImportSection = z.infer<typeof ResumeImportSectionSchema>;
export type ResumeImportReport = z.infer<typeof ResumeImportReportSchema>;
export type ResumeImportResult = z.infer<typeof ResumeImportResultSchema>;
export type FactReviewDecision = z.infer<typeof FactReviewDecisionSchema>;
