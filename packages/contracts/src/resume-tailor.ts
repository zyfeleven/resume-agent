import { z } from "zod";

import { EntityIdSchema, IsoDateTimeSchema } from "./common.js";
import { RequirementPrioritySchema } from "./job.js";

export const BaseResumeSkipReasonSchema = z.enum([
  "unverified_role",
  "unverified_organization",
  "unverified_dates",
  "unverified_fact",
]);

export const BaseResumeSkipSchema = z
  .object({
    key: z.string().min(1).max(160),
    reason: BaseResumeSkipReasonSchema,
  })
  .strict()
  .meta({
    description:
      "A resume entry that could not be built because the facts behind it are not verified. The entry is reported, never filled in from unverified data.",
  });

export const ResumeCoverageSchema = z
  .object({
    requirementId: EntityIdSchema,
    priority: RequirementPrioritySchema,
    strength: z.enum(["exact", "related", "missing"]),
    factIds: z.array(EntityIdSchema),
  })
  .strict();

export const ResumeTailorReportSchema = z
  .object({
    id: EntityIdSchema,
    jobId: EntityIdSchema,
    profileId: EntityIdSchema,
    changeSetId: EntityIdSchema,
    baseResumeVersionId: EntityIdSchema,
    generatorVersion: z.string().min(1).max(120),
    generatedAt: IsoDateTimeSchema,
    verifiedFactCount: z.number().int().nonnegative(),
    keptItemCount: z.number().int().nonnegative(),
    removedItemCount: z.number().int().nonnegative(),
    coverage: z.array(ResumeCoverageSchema),
    skipped: z.array(BaseResumeSkipSchema),
  })
  .strict();

export const ClaimViolationCodeSchema = z.enum([
  "fact_not_verified",
  "fact_not_in_snapshot",
  "requirement_not_in_snapshot",
  "before_text_altered",
  "unsupported_claim",
  "unsupported_number",
  "fact_snapshot_mismatch",
]);

export const ClaimViolationSchema = z
  .object({
    changeId: EntityIdSchema.optional(),
    code: ClaimViolationCodeSchema,
    detail: z.string().min(1).max(2_000),
  })
  .strict();

/**
 * The deterministic half of the claim guard: it decides whether a change set may reach a
 * person for review at all. It runs the same way over a change set produced by selection
 * and one produced by a model, so generated prose can never bypass it.
 */
export const ClaimGuardReportSchema = z
  .object({
    changeSetId: EntityIdSchema,
    guardVersion: z.string().min(1).max(120),
    checkedAt: IsoDateTimeSchema,
    passed: z.boolean(),
    violations: z.array(ClaimViolationSchema),
  })
  .strict();

export type BaseResumeSkipReason = z.infer<typeof BaseResumeSkipReasonSchema>;
export type BaseResumeSkip = z.infer<typeof BaseResumeSkipSchema>;
export type ResumeCoverage = z.infer<typeof ResumeCoverageSchema>;
export type ResumeTailorReport = z.infer<typeof ResumeTailorReportSchema>;
export type ClaimViolationCode = z.infer<typeof ClaimViolationCodeSchema>;
export type ClaimViolation = z.infer<typeof ClaimViolationSchema>;
export type ClaimGuardReport = z.infer<typeof ClaimGuardReportSchema>;
