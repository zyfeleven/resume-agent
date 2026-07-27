import { z } from "zod";

import {
  EntityIdSchema,
  EntityTimestampsSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from "./common.js";

export const ResumeContentItemSchema = z
  .object({
    id: EntityIdSchema,
    text: z.string().min(1).max(4_000),
    factIds: z.array(EntityIdSchema).min(1),
    requirementIds: z.array(EntityIdSchema),
  })
  .strict();

export const ResumeExperienceSchema = z
  .object({
    id: EntityIdSchema,
    organizationFactId: EntityIdSchema,
    roleFactId: EntityIdSchema,
    dateFactIds: z.array(EntityIdSchema).min(1),
    bullets: z.array(ResumeContentItemSchema),
  })
  .strict();

export const ResumeIRSchema = z
  .object({
    profileId: EntityIdSchema,
    headerFactIds: z.array(EntityIdSchema).min(1),
    summary: z.array(ResumeContentItemSchema),
    skills: z.array(ResumeContentItemSchema),
    experience: z.array(ResumeExperienceSchema),
    projects: z.array(ResumeContentItemSchema),
    education: z.array(ResumeContentItemSchema),
  })
  .strict();

export const ChangeIntentSchema = z.enum(["keep", "rewrite", "combine", "remove"]);

const ResumeChangeBaseSchema = z
  .object({
    id: EntityIdSchema,
    targetItemId: EntityIdSchema,
    factIds: z.array(EntityIdSchema).min(1),
    requirementIds: z.array(EntityIdSchema),
    rationale: z.string().min(1).max(2_000),
  })
  .strict();

export const ResumeChangeSchema = z.discriminatedUnion("intent", [
  ResumeChangeBaseSchema.extend({
    intent: z.literal("keep"),
    before: z.string().min(1).max(4_000),
  }).strict(),
  ResumeChangeBaseSchema.extend({
    intent: z.literal("rewrite"),
    before: z.string().min(1).max(4_000),
    after: z.string().min(1).max(4_000),
  }).strict(),
  ResumeChangeBaseSchema.extend({
    intent: z.literal("combine"),
    sourceItemIds: z.array(EntityIdSchema).min(2),
    before: z.array(z.string().min(1).max(4_000)).min(2),
    after: z.string().min(1).max(4_000),
  }).strict(),
  ResumeChangeBaseSchema.extend({
    intent: z.literal("remove"),
    before: z.string().min(1).max(4_000),
    after: z.null(),
  }).strict(),
]);

export const ResumeChangeSetSchema = z
  .object({
    id: EntityIdSchema,
    jobId: EntityIdSchema,
    baseResumeVersionId: EntityIdSchema,
    baseContentHash: Sha256Schema,
    resultContentHash: Sha256Schema,
    factSnapshotHash: Sha256Schema,
    requirementSnapshotHash: Sha256Schema.optional(),
    changes: z.array(ResumeChangeSchema),
    promptVersion: z.string().min(1).max(120),
    model: z.string().min(1).max(120),
    contentHash: Sha256Schema,
  })
  .extend(EntityTimestampsSchema.shape)
  .strict();

export const ResumeChangeReviewSchema = z
  .object({
    id: EntityIdSchema,
    changeSetId: EntityIdSchema,
    changeId: EntityIdSchema,
    reviewedChangeHash: Sha256Schema,
    decision: z.enum(["approved", "rejected"]),
    decidedBy: EntityIdSchema,
    decidedAt: IsoDateTimeSchema,
  })
  .strict();

export const ResumeContentApprovalSchema = z
  .object({
    id: EntityIdSchema,
    resumeVersionId: EntityIdSchema,
    profileId: EntityIdSchema,
    jobId: EntityIdSchema.optional(),
    changeSetId: EntityIdSchema,
    changeSetHash: Sha256Schema,
    approvedContentHash: Sha256Schema,
    approvedPresentationHash: Sha256Schema,
    decidedBy: EntityIdSchema,
    decidedAt: IsoDateTimeSchema,
  })
  .strict();

export const ResumeVersionStatusSchema = z.enum([
  "draft",
  "fact_checked",
  "user_approved",
  "docx_built",
  "qa_passed",
  "finalized",
]);

export const ResumeVersionSchema = z
  .object({
    id: EntityIdSchema,
    profileId: EntityIdSchema,
    jobId: EntityIdSchema.optional(),
    parentVersionId: EntityIdSchema.optional(),
    templateId: EntityIdSchema,
    resume: ResumeIRSchema,
    changeSetId: EntityIdSchema.optional(),
    status: ResumeVersionStatusSchema,
    contentHash: Sha256Schema,
  })
  .extend(EntityTimestampsSchema.shape)
  .strict();

export type ResumeIR = z.infer<typeof ResumeIRSchema>;
export type ResumeChangeSet = z.infer<typeof ResumeChangeSetSchema>;
export type ResumeChangeReview = z.infer<typeof ResumeChangeReviewSchema>;
export type ResumeContentApproval = z.infer<typeof ResumeContentApprovalSchema>;
export type ResumeVersion = z.infer<typeof ResumeVersionSchema>;
