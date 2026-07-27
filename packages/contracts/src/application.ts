import { z } from "zod";

import {
  DataSensitivitySchema,
  EntityIdSchema,
  EntityTimestampsSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  Sha256Schema,
} from "./common.js";

export const ApplicationStatusSchema = z.enum([
  "draft",
  "ready",
  "running",
  "paused",
  "needs_input",
  "needs_approval",
  "user_takeover",
  "failed_recoverable",
  "review",
  "awaiting_submit_approval",
  "submitting",
  "completed",
  "failed_final",
  "cancelled",
]);

export const ApplicationSchema = z
  .object({
    id: EntityIdSchema,
    jobId: EntityIdSchema,
    profileId: EntityIdSchema,
    resumeVersionId: EntityIdSchema,
    targetUrl: HttpUrlSchema,
    status: ApplicationStatusSchema,
    currentRunId: EntityIdSchema.optional(),
  })
  .extend(EntityTimestampsSchema.shape)
  .strict();

export const FormControlTypeSchema = z.enum([
  "text",
  "email",
  "phone",
  "number",
  "date",
  "textarea",
  "select",
  "combobox",
  "radio",
  "checkbox",
  "toggle",
  "file",
  "button",
  "unknown",
]);

export const LocatorStrategySchema = z.enum([
  "role",
  "label",
  "placeholder",
  "name",
  "test_id",
  "css",
  "xpath",
]);

export const LocatorRecipeSchema = z
  .object({
    strategy: LocatorStrategySchema,
    value: z.string().min(1).max(1_000),
    exact: z.boolean(),
    framePath: z.array(z.string().min(1).max(500)),
  })
  .strict();

export const FieldOptionSchema = z
  .object({
    label: z.string().min(1).max(500),
    value: JsonValueSchema,
  })
  .strict();

export const FieldObservationSchema = z
  .object({
    id: EntityIdSchema,
    applicationId: EntityIdSchema,
    pageId: EntityIdSchema,
    pageFingerprint: Sha256Schema,
    question: z.string().min(1).max(2_000),
    controlType: FormControlTypeSchema,
    required: z.boolean(),
    sensitivity: DataSensitivitySchema,
    options: z.array(FieldOptionSchema),
    locator: LocatorRecipeSchema,
  })
  .strict();

export const FieldRiskSchema = z.enum(["low", "medium", "high", "consequential"]);
export const FieldDecisionOutcomeSchema = z.enum([
  "auto_fill",
  "draft_for_review",
  "ask_user",
  "takeover",
  "block",
]);

const FieldDecisionBaseSchema = z
  .object({
    id: EntityIdSchema,
    observationId: EntityIdSchema,
    canonicalField: z.string().min(1).max(240),
    proposedValue: JsonValueSchema,
    rationale: z.string().min(1).max(2_000),
  })
  .strict();

export const FieldDecisionSchema = z.discriminatedUnion("outcome", [
  FieldDecisionBaseSchema.extend({
    outcome: z.literal("auto_fill"),
    sourceFactIds: z.array(EntityIdSchema).min(1),
    sourceAnswerPolicyId: EntityIdSchema.optional(),
    confidence: z.number().min(0.9).max(1),
    risk: z.literal("low"),
  }).strict(),
  FieldDecisionBaseSchema.extend({
    outcome: z.literal("draft_for_review"),
    sourceFactIds: z.array(EntityIdSchema).min(1),
    sourceAnswerPolicyId: EntityIdSchema.optional(),
    confidence: z.number().min(0.7).max(1),
    risk: z.enum(["low", "medium"]),
  }).strict(),
  FieldDecisionBaseSchema.extend({
    outcome: z.literal("ask_user"),
    sourceFactIds: z.array(EntityIdSchema),
    confidence: z.number().min(0).max(1),
    risk: FieldRiskSchema,
  }).strict(),
  FieldDecisionBaseSchema.extend({
    outcome: z.literal("takeover"),
    sourceFactIds: z.array(EntityIdSchema),
    confidence: z.number().min(0).max(1),
    risk: z.enum(["high", "consequential"]),
  }).strict(),
  FieldDecisionBaseSchema.extend({
    outcome: z.literal("block"),
    sourceFactIds: z.array(EntityIdSchema),
    confidence: z.number().min(0).max(1),
    risk: FieldRiskSchema,
  }).strict(),
]);

export const ActionRiskSchema = z.enum(["read_only", "reversible", "takeover", "consequential"]);

export const AgentActionSchema = z
  .object({
    id: EntityIdSchema,
    runId: EntityIdSchema,
    tool: z.string().min(1).max(160),
    risk: ActionRiskSchema,
    arguments: z.record(z.string(), JsonValueSchema),
    pageFingerprint: Sha256Schema.optional(),
    requestedAt: IsoDateTimeSchema,
  })
  .strict();

export const ApprovalStatusSchema = z.enum(["pending", "approved", "rejected", "expired", "consumed"]);

const ApprovalBaseSchema = z
  .object({
    id: EntityIdSchema,
    applicationId: EntityIdSchema,
    runId: EntityIdSchema,
    actionId: EntityIdSchema,
    reason: z.string().min(1).max(2_000),
    reviewSnapshotHash: Sha256Schema,
    expiresAt: IsoDateTimeSchema,
  })
  .extend(EntityTimestampsSchema.shape)
  .strict();

export const ApprovalDecisionSchema = z
  .object({
    decidedBy: EntityIdSchema,
    decidedAt: IsoDateTimeSchema,
    note: z.string().max(2_000).optional(),
  })
  .strict();

export const ApprovalRequestSchema = z.discriminatedUnion("status", [
  ApprovalBaseSchema.extend({
    status: z.literal("pending"),
  }).strict(),
  ApprovalBaseSchema.extend({
    status: z.literal("approved"),
    decision: ApprovalDecisionSchema,
  }).strict(),
  ApprovalBaseSchema.extend({
    status: z.literal("rejected"),
    decision: ApprovalDecisionSchema,
  }).strict(),
  ApprovalBaseSchema.extend({
    status: z.literal("expired"),
    expiredAt: IsoDateTimeSchema,
  }).strict(),
  ApprovalBaseSchema.extend({
    status: z.literal("consumed"),
    decision: ApprovalDecisionSchema,
    consumedBy: EntityIdSchema,
    consumedAt: IsoDateTimeSchema,
  }).strict(),
]);

export const ApplicationCheckpointSchema = z
  .object({
    id: EntityIdSchema,
    applicationId: EntityIdSchema,
    runId: EntityIdSchema,
    sequence: z.number().int().nonnegative(),
    stateRevision: z.number().int().nonnegative(),
    status: ApplicationStatusSchema,
    browserSessionRef: EntityIdSchema,
    allowedOrigin: HttpUrlSchema,
    url: HttpUrlSchema,
    pageFingerprint: Sha256Schema,
    completedActionIds: z.array(EntityIdSchema),
    fieldDecisionIds: z.array(EntityIdSchema),
    artifactIds: z.array(EntityIdSchema),
    pendingRequestId: EntityIdSchema.optional(),
    reviewSnapshotHash: Sha256Schema.optional(),
    lastAuditEventHash: Sha256Schema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export type Application = z.infer<typeof ApplicationSchema>;
export type FieldObservation = z.infer<typeof FieldObservationSchema>;
export type FieldDecision = z.infer<typeof FieldDecisionSchema>;
export type AgentAction = z.infer<typeof AgentActionSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ApplicationCheckpoint = z.infer<typeof ApplicationCheckpointSchema>;
