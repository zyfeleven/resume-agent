import type { z } from "zod";

import { AgentActionSchema, ApplicationCheckpointSchema, ApplicationSchema, ApprovalRequestSchema, FieldDecisionSchema, FieldObservationSchema } from "./application.js";
import { ArtifactSchema, AuditEventSchema } from "./audit.js";
import {
  BrowserActivateInputSchema,
  BrowserActivateOutputSchema,
  BrowserLivePageObservationSchema,
  BrowserMcpToolDescriptorSchema,
  BrowserNavigateInputSchema,
  BrowserNavigateOutputSchema,
  BrowserPageSnapshotSchema,
  BrowserRequestTakeoverInputSchema,
  BrowserRequestTakeoverOutputSchema,
  BrowserSessionOpenInputSchema,
  BrowserSessionOpenOutputSchema,
  BrowserSetFieldInputSchema,
  BrowserSetFieldOutputSchema,
  BrowserSetFileInputSchema,
  BrowserSetFileOutputSchema,
  BrowserSnapshotInputSchema,
  BrowserSnapshotOutputSchema,
  BrowserSubmitInputSchema,
  BrowserSubmitOutputSchema,
  BrowserTrustedAuthorizationRecordSchema,
  BrowserTrustedArtifactRecordSchema,
  BrowserTrustedEvidenceRecordSchema,
} from "./browser-mcp.js";
import { BrowserMcpWireToolSchema } from "./browser-mcp-wire.js";
import { BrowserWriteValidationContextSchema } from "./browser-mcp-validation.js";
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
  BrowserActivateInput: BrowserActivateInputSchema,
  BrowserActivateOutput: BrowserActivateOutputSchema,
  BrowserLivePageObservation: BrowserLivePageObservationSchema,
  BrowserMcpToolDescriptor: BrowserMcpToolDescriptorSchema,
  BrowserMcpWireTool: BrowserMcpWireToolSchema,
  BrowserNavigateInput: BrowserNavigateInputSchema,
  BrowserNavigateOutput: BrowserNavigateOutputSchema,
  BrowserPageSnapshot: BrowserPageSnapshotSchema,
  BrowserRequestTakeoverInput: BrowserRequestTakeoverInputSchema,
  BrowserRequestTakeoverOutput: BrowserRequestTakeoverOutputSchema,
  BrowserSessionOpenInput: BrowserSessionOpenInputSchema,
  BrowserSessionOpenOutput: BrowserSessionOpenOutputSchema,
  BrowserSetFieldInput: BrowserSetFieldInputSchema,
  BrowserSetFieldOutput: BrowserSetFieldOutputSchema,
  BrowserSetFileInput: BrowserSetFileInputSchema,
  BrowserSetFileOutput: BrowserSetFileOutputSchema,
  BrowserSnapshotInput: BrowserSnapshotInputSchema,
  BrowserSnapshotOutput: BrowserSnapshotOutputSchema,
  BrowserSubmitInput: BrowserSubmitInputSchema,
  BrowserSubmitOutput: BrowserSubmitOutputSchema,
  BrowserTrustedAuthorizationRecord: BrowserTrustedAuthorizationRecordSchema,
  BrowserTrustedArtifactRecord: BrowserTrustedArtifactRecordSchema,
  BrowserTrustedEvidenceRecord: BrowserTrustedEvidenceRecordSchema,
  BrowserWriteValidationContext: BrowserWriteValidationContextSchema,
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
