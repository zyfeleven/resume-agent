import { z } from "zod";

import {
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from "./common.js";
import { JDRequirementSchema, RequirementKindSchema, RequirementPrioritySchema } from "./job.js";

export const JdSectionKindSchema = z.enum([
  "intro",
  "responsibilities",
  "requirements",
  "preferred",
  "benefits",
  "about",
  "legal",
  "unrecognized",
]);

export const JdParseSkipReasonSchema = z.enum([
  "possible_injection",
  "possible_secret",
  "duplicate_requirement",
  "line_too_long",
  "not_a_requirement",
  "non_requirement_section",
]);

export const JdParseSourceSchema = z
  .object({
    artifactId: EntityIdSchema,
    contentHash: Sha256Schema,
    byteSize: z.number().int().positive(),
  })
  .strict();

export const JdParseRequestSchema = z
  .object({
    jobId: EntityIdSchema,
    source: JdParseSourceSchema,
    text: z
      .string()
      .min(1)
      .max(200_000)
      .meta({
        description:
          "Job description text pasted by the user. It is untrusted input: the parser reads it as data and never as instructions.",
      }),
    parsedAt: IsoDateTimeSchema,
  })
  .strict();

export const JdParseSectionSchema = z
  .object({
    kind: JdSectionKindSchema,
    heading: z.string().min(1).max(160).optional(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .strict();

export const JdParseSkipSchema = z
  .object({
    line: z.number().int().positive(),
    reason: JdParseSkipReasonSchema,
  })
  .strict()
  .meta({
    description:
      "A source line that produced no requirement. Skipped text is never copied into the report, so agent-directed text in a job posting cannot reach a prompt through parse telemetry.",
  });

export const JdParseCountSchema = z
  .object({
    priority: RequirementPrioritySchema,
    count: z.number().int().positive(),
  })
  .strict();

export const JdParseReportSchema = z
  .object({
    id: EntityIdSchema,
    jobId: EntityIdSchema,
    artifactId: EntityIdSchema,
    parserVersion: z.string().min(1).max(120),
    parsedAt: IsoDateTimeSchema,
    sourceLineCount: z.number().int().nonnegative(),
    sections: z.array(JdParseSectionSchema),
    priorityCounts: z.array(JdParseCountSchema),
    requirementIds: z.array(EntityIdSchema),
    skipped: z.array(JdParseSkipSchema),
  })
  .strict();

export const JdParseResultSchema = z
  .object({
    report: JdParseReportSchema,
    requirements: z.array(JDRequirementSchema),
  })
  .strict();

/**
 * A reviewer correction to one parsed requirement.
 *
 * Requirement IDs are derived from the job and the requirement text, so a decision can
 * never land on text the reviewer did not see: changed text is a different requirement.
 */
export const RequirementReviewDecisionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("set_priority"),
      requirementId: EntityIdSchema,
      priority: RequirementPrioritySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("set_kind"),
      requirementId: EntityIdSchema,
      kind: RequirementKindSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("dismiss"),
      requirementId: EntityIdSchema,
    })
    .strict(),
]);

export type JdSectionKind = z.infer<typeof JdSectionKindSchema>;
export type JdParseSkipReason = z.infer<typeof JdParseSkipReasonSchema>;
export type JdParseSource = z.infer<typeof JdParseSourceSchema>;
export type JdParseRequest = z.infer<typeof JdParseRequestSchema>;
export type JdParseSection = z.infer<typeof JdParseSectionSchema>;
export type JdParseReport = z.infer<typeof JdParseReportSchema>;
export type JdParseResult = z.infer<typeof JdParseResultSchema>;
export type RequirementReviewDecision = z.infer<typeof RequirementReviewDecisionSchema>;
