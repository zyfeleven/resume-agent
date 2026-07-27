import { z } from "zod";

import {
  DataSensitivitySchema,
  EntityIdSchema,
  EntityTimestampsSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  SourceLocatorSchema,
} from "./common.js";

export const FactKindSchema = z.enum([
  "identity",
  "contact",
  "employment",
  "achievement",
  "skill",
  "education",
  "project",
  "credential",
  "preference",
  "work_authorization",
]);

export const FactStatusSchema = z.enum(["pending", "verified", "rejected"]);

export const FactVerificationSchema = z
  .object({
    verifiedBy: z.enum(["user", "trusted_source"]),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const FactRejectionSchema = z
  .object({
    rejectedBy: EntityIdSchema,
    rejectedAt: IsoDateTimeSchema,
    reason: z.string().min(1).max(2_000),
  })
  .strict();

const FactBaseSchema = z
  .object({
    id: EntityIdSchema,
    profileId: EntityIdSchema,
    kind: FactKindSchema,
    key: z.string().min(1).max(160),
    value: JsonValueSchema,
    sensitivity: DataSensitivitySchema,
    sources: z.array(SourceLocatorSchema).min(1),
    version: z.number().int().positive(),
  })
  .extend(EntityTimestampsSchema.shape)
  .strict();

export const FactSchema = z.discriminatedUnion("status", [
  FactBaseSchema.extend({
    status: z.literal("pending"),
  }).strict(),
  FactBaseSchema.extend({
    status: z.literal("verified"),
    verification: FactVerificationSchema,
  }).strict(),
  FactBaseSchema.extend({
    status: z.literal("rejected"),
    rejection: FactRejectionSchema,
  }).strict(),
]);

export const CandidateProfileSchema = z
  .object({
    id: EntityIdSchema,
    displayName: z.string().min(1).max(160),
    factIds: z.array(EntityIdSchema),
    version: z.number().int().positive(),
  })
  .extend(EntityTimestampsSchema.shape)
  .strict();

export const AnswerReusePolicySchema = z.enum([
  "this_application_only",
  "reuse_with_confirmation",
  "always_ask",
]);

const AnswerPolicyBaseSchema = z
  .object({
    id: EntityIdSchema,
    profileId: EntityIdSchema,
    canonicalQuestion: z.string().min(1).max(1_000),
    value: JsonValueSchema,
    sourceFactIds: z.array(EntityIdSchema).min(1),
    sensitivity: DataSensitivitySchema,
    expiresAt: IsoDateTimeSchema.optional(),
  })
  .extend(EntityTimestampsSchema.shape)
  .strict();

export const AnswerPolicySchema = z.discriminatedUnion("reuse", [
  AnswerPolicyBaseSchema.extend({
    reuse: z.literal("this_application_only"),
    applicationId: EntityIdSchema,
  }).strict(),
  AnswerPolicyBaseSchema.extend({
    reuse: z.literal("reuse_with_confirmation"),
  }).strict(),
  AnswerPolicyBaseSchema.extend({
    reuse: z.literal("always_ask"),
  }).strict(),
]);

export type Fact = z.infer<typeof FactSchema>;
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
export type AnswerPolicy = z.infer<typeof AnswerPolicySchema>;
