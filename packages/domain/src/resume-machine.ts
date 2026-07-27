import {
  EntityIdSchema,
  IsoDateTimeSchema,
  ResumeVersionStatusSchema,
  Sha256Schema,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";
import { z } from "zod";

import { TransitionError } from "./errors.js";

const EventBaseShape = {
  id: EntityIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  occurredAt: IsoDateTimeSchema,
};

const event = <const TType extends string, T extends z.ZodRawShape>(type: TType, shape: T) =>
  z.object({ ...EventBaseShape, type: z.literal(type), ...shape }).strict();

export const ResumeEventSchema = z.discriminatedUnion("type", [
  event("FACT_CHECK_PASSED", {}),
  event("USER_APPROVED", { changeSetId: EntityIdSchema, approvedContentHash: Sha256Schema }),
  event("DOCX_BUILT", {
    artifactId: EntityIdSchema,
    artifactHash: Sha256Schema,
    manifestArtifactId: EntityIdSchema,
    sourceContentHash: Sha256Schema,
  }),
  event("QA_FAILED", { reportArtifactId: EntityIdSchema }),
  event("QA_PASSED", { artifactHash: Sha256Schema, reportArtifactId: EntityIdSchema }),
  event("FINALIZE", { artifactHash: Sha256Schema }),
]);

export type ResumeEvent = z.infer<typeof ResumeEventSchema>;
export type ResumeStatus = z.infer<typeof ResumeVersionStatusSchema>;

export interface ResumeMachineState {
  resumeVersionId: string;
  status: ResumeStatus;
  revision: number;
  contentHash: string;
  processedEventIds: string[];
  processedEventFingerprints: Record<string, string>;
  processedEventAudits: Record<string, ResumeAuditEvent>;
  changeSetId?: string | undefined;
  artifactId?: string | undefined;
  artifactHash?: string | undefined;
  manifestArtifactId?: string | undefined;
  qaReportArtifactId?: string | undefined;
  qaApprovedArtifactHash?: string | undefined;
  lastEventAt?: string | undefined;
}

export interface ResumeTransitionContext {
  allClaimsFactBacked?: boolean;
  allFactsVerified?: boolean;
  deterministicClaimChecksPassed?: boolean;
  semanticClaimChecksPassed?: boolean;
  approvalPersisted?: boolean;
  approvalContentHash?: string;
  approvalChangeSetId?: string;
  manifestPersisted?: boolean;
  manifestMatchesInputs?: boolean;
  structureCheckPassed?: boolean;
  privacyCheckPassed?: boolean;
  renderCheckPassed?: boolean;
  visualCheckPassed?: boolean;
  exportPersisted?: boolean;
}

export interface ResumeAuditEvent {
  id: string;
  causedByEventId: string;
  eventType: ResumeEvent["type"];
  fromStatus: ResumeStatus;
  toStatus: ResumeStatus;
  occurredAt: string;
}

export interface ResumeTransitionResult {
  state: ResumeMachineState;
  idempotent: boolean;
  audit: ResumeAuditEvent;
}

function requireGuard(value: boolean | undefined, message: string): asserts value is true {
  if (value !== true) {
    throw new TransitionError("GUARD_FAILED", message);
  }
}

function requireStatus(
  state: ResumeMachineState,
  eventType: ResumeEvent["type"],
  ...allowed: ResumeStatus[]
): void {
  if (!allowed.includes(state.status)) {
    throw new TransitionError(
      "INVALID_TRANSITION",
      `${eventType} is not allowed from ${state.status}.`,
    );
  }
}

function advance(
  state: ResumeMachineState,
  eventValue: ResumeEvent,
  status: ResumeStatus,
  patch: Partial<ResumeMachineState> = {},
): ResumeTransitionResult {
  const audit: ResumeAuditEvent = {
    id: `${eventValue.id}:audit`,
    causedByEventId: eventValue.id,
    eventType: eventValue.type,
    fromStatus: state.status,
    toStatus: status,
    occurredAt: eventValue.occurredAt,
  };
  return {
    state: {
      ...state,
      ...patch,
      status,
      revision: state.revision + 1,
      processedEventIds: [...state.processedEventIds, eventValue.id],
      processedEventFingerprints: {
        ...state.processedEventFingerprints,
        [eventValue.id]: fingerprintEvent(eventValue),
      },
      processedEventAudits: {
        ...state.processedEventAudits,
        [eventValue.id]: audit,
      },
      lastEventAt: eventValue.occurredAt,
    },
    idempotent: false,
    audit,
  };
}

function fingerprintEvent(eventValue: ResumeEvent): string {
  return createHash("sha256").update(JSON.stringify(eventValue)).digest("hex");
}

export function createResumeMachineState(
  resumeVersionId: string,
  contentHash: string,
): ResumeMachineState {
  return {
    resumeVersionId: EntityIdSchema.parse(resumeVersionId),
    status: "draft",
    revision: 0,
    contentHash: Sha256Schema.parse(contentHash),
    processedEventIds: [],
    processedEventFingerprints: {},
    processedEventAudits: {},
  };
}

export function transitionResume(
  state: ResumeMachineState,
  eventInput: ResumeEvent,
  context: ResumeTransitionContext,
): ResumeTransitionResult {
  const eventValue = ResumeEventSchema.parse(eventInput);

  const eventHash = fingerprintEvent(eventValue);
  const previousEventHash = state.processedEventFingerprints[eventValue.id];
  if (previousEventHash) {
    if (previousEventHash !== eventHash) {
      throw new TransitionError(
        "DUPLICATE_EVENT_CONFLICT",
        `Event ${eventValue.id} was already processed with different content.`,
      );
    }
    const audit = state.processedEventAudits[eventValue.id];
    if (!audit) {
      throw new TransitionError("GUARD_FAILED", "Processed event is missing its durable audit record.");
    }
    return { state, idempotent: true, audit };
  }
  if (eventValue.expectedRevision !== state.revision) {
    throw new TransitionError("STALE_REVISION", "Resume event revision is stale.");
  }
  if (state.status === "finalized") {
    throw new TransitionError("INVALID_TRANSITION", "A finalized resume is immutable.");
  }
  if (state.lastEventAt && Date.parse(eventValue.occurredAt) < Date.parse(state.lastEventAt)) {
    throw new TransitionError("GUARD_FAILED", "Event time cannot move backwards.");
  }

  switch (eventValue.type) {
    case "FACT_CHECK_PASSED":
      requireStatus(state, eventValue.type, "draft");
      requireGuard(context.allClaimsFactBacked, "Every claim must reference facts.");
      requireGuard(context.allFactsVerified, "Every referenced fact must be verified.");
      requireGuard(context.deterministicClaimChecksPassed, "Deterministic claim checks failed.");
      requireGuard(context.semanticClaimChecksPassed, "Semantic claim checks failed.");
      return advance(state, eventValue, "fact_checked");

    case "USER_APPROVED":
      requireStatus(state, eventValue.type, "fact_checked");
      requireGuard(context.approvalPersisted, "User approval must be persisted.");
      if (
        eventValue.approvedContentHash !== state.contentHash ||
        context.approvalContentHash !== state.contentHash ||
        context.approvalChangeSetId !== eventValue.changeSetId
      ) {
        throw new TransitionError("GUARD_FAILED", "Approval does not match this resume content.");
      }
      return advance(state, eventValue, "user_approved", { changeSetId: eventValue.changeSetId });

    case "DOCX_BUILT":
      requireStatus(state, eventValue.type, "user_approved", "docx_built");
      requireGuard(context.manifestPersisted, "Document manifest must be persisted.");
      requireGuard(context.manifestMatchesInputs, "Document manifest does not match its inputs.");
      if (eventValue.sourceContentHash !== state.contentHash) {
        throw new TransitionError("GUARD_FAILED", "DOCX was built from different resume content.");
      }
      return advance(state, eventValue, "docx_built", {
        artifactId: eventValue.artifactId,
        artifactHash: eventValue.artifactHash,
        manifestArtifactId: eventValue.manifestArtifactId,
        qaReportArtifactId: undefined,
        qaApprovedArtifactHash: undefined,
      });

    case "QA_FAILED":
      requireStatus(state, eventValue.type, "docx_built");
      return advance(state, eventValue, "docx_built", {
        qaReportArtifactId: eventValue.reportArtifactId,
      });

    case "QA_PASSED":
      requireStatus(state, eventValue.type, "docx_built");
      requireGuard(context.structureCheckPassed, "Structure QA failed.");
      requireGuard(context.privacyCheckPassed, "Privacy QA failed.");
      requireGuard(context.renderCheckPassed, "Render QA failed.");
      requireGuard(context.visualCheckPassed, "Visual QA failed.");
      if (eventValue.artifactHash !== state.artifactHash) {
        throw new TransitionError("GUARD_FAILED", "QA result is for a different artifact.");
      }
      return advance(state, eventValue, "qa_passed", {
        qaReportArtifactId: eventValue.reportArtifactId,
        qaApprovedArtifactHash: eventValue.artifactHash,
      });

    case "FINALIZE":
      requireStatus(state, eventValue.type, "qa_passed");
      requireGuard(context.exportPersisted, "Final export must be persisted.");
      if (
        eventValue.artifactHash !== state.artifactHash ||
        eventValue.artifactHash !== state.qaApprovedArtifactHash
      ) {
        throw new TransitionError("GUARD_FAILED", "Final export is not the QA-approved artifact.");
      }
      return advance(state, eventValue, "finalized");
  }

  throw new TransitionError("INVALID_TRANSITION", "Unknown resume event.");
}
