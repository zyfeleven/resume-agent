import { z } from "zod";

import {
  EntityIdSchema,
  EntityTimestampsSchema,
  HttpUrlSchema,
  Sha256Schema,
  SourceLocatorSchema,
} from "./common.js";

export const JobStatusSchema = z.enum(["draft", "active", "closed", "archived"]);

export const JobSchema = z
  .object({
    id: EntityIdSchema,
    title: z.string().min(1).max(240),
    company: z.string().min(1).max(240),
    location: z.string().max(240).optional(),
    sourceUrl: HttpUrlSchema.optional(),
    descriptionArtifactId: EntityIdSchema,
    descriptionHash: Sha256Schema,
    status: JobStatusSchema,
  })
  .extend(EntityTimestampsSchema.shape)
  .strict();

export const RequirementKindSchema = z.enum([
  "responsibility",
  "skill",
  "experience",
  "education",
  "credential",
  "behavior",
  "other",
]);

export const RequirementPrioritySchema = z.enum(["must_have", "preferred", "context"]);

export const JDRequirementSchema = z
  .object({
    id: EntityIdSchema,
    jobId: EntityIdSchema,
    kind: RequirementKindSchema,
    priority: RequirementPrioritySchema,
    text: z.string().min(1).max(2_000),
    keywords: z.array(z.string().min(1).max(120)),
    source: SourceLocatorSchema,
  })
  .strict();

export const RequirementMatchStrengthSchema = z.enum([
  "exact",
  "related",
  "missing",
  "conflict",
]);

export const RequirementFactMatchSchema = z
  .object({
    requirementId: EntityIdSchema,
    factIds: z.array(EntityIdSchema),
    strength: RequirementMatchStrengthSchema,
    rationale: z.string().min(1).max(2_000),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type Job = z.infer<typeof JobSchema>;
export type JDRequirement = z.infer<typeof JDRequirementSchema>;
export type RequirementFactMatch = z.infer<typeof RequirementFactMatchSchema>;
