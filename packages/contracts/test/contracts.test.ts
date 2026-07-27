import { describe, expect, it } from "vitest";

import {
  ApplicationSchema,
  ApprovalRequestSchema,
  ArtifactSchema,
  FactSchema,
  FieldDecisionSchema,
  ResumeChangeSetSchema,
  schemaRegistry,
} from "../src/index.js";

const now = "2026-07-26T16:00:00-04:00";
const hash = "a".repeat(64);

describe("shared contracts", () => {
  it("accepts a sourced and verified candidate fact", () => {
    const fact = FactSchema.parse({
      id: "fact:achievement:1",
      profileId: "profile:1",
      kind: "achievement",
      key: "experience.0.achievement.0",
      value: {
        action: "Reduced request latency",
        metric: "35%",
      },
      status: "verified",
      sensitivity: "normal",
      sources: [
        {
          artifactId: "artifact:master-resume",
          locator: "Experience > Example Corp > bullet 1",
          excerpt: "Reduced API request latency by 35%.",
        },
      ],
      verification: {
        verifiedBy: "user",
        verifiedAt: now,
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    expect(fact.status).toBe("verified");
    expect(fact.sources).toHaveLength(1);
  });

  it("rejects a resume change without supporting facts", () => {
    const result = ResumeChangeSetSchema.safeParse({
      id: "changeset:1",
      jobId: "job:1",
      baseResumeVersionId: "resume:1",
      changes: [
        {
          id: "change:1",
          targetItemId: "bullet:1",
          intent: "rewrite",
          before: "Built APIs.",
          after: "Led a global platform transformation.",
          factIds: [],
          requirementIds: ["requirement:1"],
          rationale: "Match the leadership requirement.",
        },
      ],
      promptVersion: "resume-tailor-v1",
      model: "test-model",
      contentHash: hash,
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });

  it("keeps confidence within a closed zero-to-one range", () => {
    const result = FieldDecisionSchema.safeParse({
      id: "decision:1",
      observationId: "field:1",
      canonicalField: "candidate.email",
      proposedValue: "person@example.com",
      sourceFactIds: ["fact:email"],
      confidence: 1.01,
      risk: "low",
      outcome: "auto_fill",
      rationale: "Exact label and verified fact match.",
    });

    expect(result.success).toBe(false);
  });

  it("does not allow unsupported or consequential auto-fill decisions", () => {
    const result = FieldDecisionSchema.safeParse({
      id: "decision:unsafe",
      observationId: "field:1",
      canonicalField: "candidate.disability_status",
      proposedValue: "No",
      sourceFactIds: [],
      confidence: 0.99,
      risk: "consequential",
      outcome: "auto_fill",
      rationale: "Unsafe caller-provided decision.",
    });

    expect(result.success).toBe(false);
  });

  it("requires verification evidence for verified facts", () => {
    const result = FactSchema.safeParse({
      id: "fact:skill:1",
      profileId: "profile:1",
      kind: "skill",
      key: "skills.typescript",
      value: "TypeScript",
      status: "verified",
      sensitivity: "normal",
      sources: [{ artifactId: "artifact:resume", locator: "Skills" }],
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });

  it("requires decision provenance for approved actions", () => {
    const result = ApprovalRequestSchema.safeParse({
      id: "approval:forged",
      applicationId: "application:1",
      runId: "run:1",
      actionId: "action:submit",
      status: "approved",
      reason: "Final application submission.",
      reviewSnapshotHash: hash,
      expiresAt: "2026-07-26T16:15:00-04:00",
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });

  it("rejects path traversal in artifacts", () => {
    const result = ArtifactSchema.safeParse({
      id: "artifact:1",
      kind: "tailored_resume",
      fileName: "../resume.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      contentHash: hash,
      byteSize: 1_024,
      storageKey: "../../outside",
      sensitivity: "pii",
      createdAt: now,
    });

    expect(result.success).toBe(false);
  });

  it("accepts only HTTP browser targets", () => {
    const baseApplication = {
      id: "application:1",
      jobId: "job:1",
      profileId: "profile:1",
      resumeVersionId: "resume:1",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    expect(
      ApplicationSchema.safeParse({
        ...baseApplication,
        targetUrl: "javascript:alert(document.domain)",
      }).success,
    ).toBe(false);
    expect(
      ApplicationSchema.safeParse({
        ...baseApplication,
        targetUrl: "file:///C:/Users/example/.ssh/id_rsa",
      }).success,
    ).toBe(false);
    expect(
      ApplicationSchema.safeParse({
        ...baseApplication,
        targetUrl: "https://jobs.example.com/apply",
      }).success,
    ).toBe(true);
  });

  it("binds approvals to an exact review snapshot", () => {
    const approval = ApprovalRequestSchema.parse({
      id: "approval:1",
      applicationId: "application:1",
      runId: "run:1",
      actionId: "action:submit",
      status: "pending",
      reason: "Final application submission.",
      reviewSnapshotHash: hash,
      expiresAt: "2026-07-26T16:15:00-04:00",
      createdAt: now,
      updatedAt: now,
    });

    expect(approval.reviewSnapshotHash).toBe(hash);
  });

  it("registers every public schema with a stable name", () => {
    expect(Object.keys(schemaRegistry)).toEqual([
      "AnswerPolicy",
      "AgentAction",
      "Application",
      "ApplicationCheckpoint",
      "ApprovalRequest",
      "Artifact",
      "AuditEvent",
      "BrowserActivateInput",
      "BrowserActivateOutput",
      "BrowserLivePageObservation",
      "BrowserMcpToolDescriptor",
      "BrowserMcpWireTool",
      "BrowserNavigateInput",
      "BrowserNavigateOutput",
      "BrowserPageSnapshot",
      "BrowserRequestTakeoverInput",
      "BrowserRequestTakeoverOutput",
      "BrowserSessionOpenInput",
      "BrowserSessionOpenOutput",
      "BrowserSetFieldInput",
      "BrowserSetFieldOutput",
      "BrowserSetFileInput",
      "BrowserSetFileOutput",
      "BrowserSnapshotInput",
      "BrowserSnapshotOutput",
      "BrowserSubmitInput",
      "BrowserSubmitOutput",
      "BrowserTrustedAuthorizationRecord",
      "BrowserTrustedArtifactRecord",
      "BrowserTrustedEvidenceRecord",
      "BrowserWriteValidationContext",
      "CandidateProfile",
      "ArtifactExportInput",
      "ArtifactExportOutput",
      "DocumentBuildManifest",
      "DocumentContentBinding",
      "DocumentExportManifest",
      "DocumentMcpToolDescriptor",
      "DocumentMcpWireTool",
      "DocumentPrivacyReport",
      "DocumentPresentationBinding",
      "DocumentPresentationItem",
      "DocumentPresentationPlan",
      "DocumentPresentationSource",
      "DocumentQaReport",
      "DocumentRenderManifest",
      "DocumentSnapshot",
      "DocumentTemplateProfile",
      "DocumentTextDiffReport",
      "DocumentTrustedArtifactRecord",
      "DocumentTrustedAuthorizationRecord",
      "DocumentTrustedComparatorRecord",
      "DocumentTrustedFactRecord",
      "DocumentTrustedInspectorRecord",
      "DocumentTrustedNonCreationEvidenceRecord",
      "DocumentTrustedParserRecord",
      "DocumentTrustedQaEvidenceRecord",
      "DocumentTrustedRendererRecord",
      "DocumentTrustedRequirementRecord",
      "DocumentTrustedResumeRecord",
      "DocumentTrustedTemplateRecord",
      "DocumentTrustedWorkerRecord",
      "DocumentVerifiedFactBinding",
      "DocumentValidationContext",
      "DocumentVisualDiffReport",
      "DocxApplyChangesetInput",
      "DocxApplyChangesetOutput",
      "DocxParseInput",
      "DocxParseOutput",
      "DocxPrivacyScrubInput",
      "DocxPrivacyScrubOutput",
      "DocxRenderPagesInput",
      "DocxRenderPagesOutput",
      "DocxStructureAuditInput",
      "DocxStructureAuditOutput",
      "DocxTextDiffInput",
      "DocxTextDiffOutput",
      "DocxVisualDiffInput",
      "DocxVisualDiffOutput",
      "Fact",
      "FieldDecision",
      "FieldObservation",
      "JDRequirement",
      "Job",
      "RequirementFactMatch",
      "ResumeChangeReview",
      "ResumeChangeSet",
      "ResumeContentApproval",
      "ResumeIR",
      "ResumeVersion",
      "TemplateInspectInput",
      "TemplateInspectOutput",
    ]);
  });
});
