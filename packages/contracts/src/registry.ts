import type { z } from "zod";

import { AgentActionSchema, ApplicationCheckpointSchema, ApplicationSchema, ApprovalRequestSchema, FieldDecisionSchema, FieldObservationSchema } from "./application.js";
import { ArtifactSchema, AuditEventSchema } from "./audit.js";
import { JobSchema, JDRequirementSchema, RequirementFactMatchSchema } from "./job.js";
import { AnswerPolicySchema, CandidateProfileSchema, FactSchema } from "./profile.js";
import { ResumeChangeReviewSchema, ResumeChangeSetSchema, ResumeIRSchema, ResumeVersionSchema } from "./resume.js";

export const schemaRegistry = {
  AnswerPolicy: AnswerPolicySchema,
  AgentAction: AgentActionSchema,
  Application: ApplicationSchema,
  ApplicationCheckpoint: ApplicationCheckpointSchema,
  ApprovalRequest: ApprovalRequestSchema,
  Artifact: ArtifactSchema,
  AuditEvent: AuditEventSchema,
  CandidateProfile: CandidateProfileSchema,
  Fact: FactSchema,
  FieldDecision: FieldDecisionSchema,
  FieldObservation: FieldObservationSchema,
  JDRequirement: JDRequirementSchema,
  Job: JobSchema,
  RequirementFactMatch: RequirementFactMatchSchema,
  ResumeChangeReview: ResumeChangeReviewSchema,
  ResumeChangeSet: ResumeChangeSetSchema,
  ResumeIR: ResumeIRSchema,
  ResumeVersion: ResumeVersionSchema,
} satisfies Record<string, z.ZodType>;

export type SchemaName = keyof typeof schemaRegistry;
