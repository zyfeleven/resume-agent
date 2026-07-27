import {
  ActionRiskSchema,
  ApplicationCheckpointSchema,
  ApplicationStatusSchema,
  ApprovalRequestSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  type ApprovalRequest,
  type ApplicationCheckpoint,
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

export const ApplicationEventSchema = z.discriminatedUnion("type", [
  event("MARK_READY", {}),
  event("START_RUN", { runId: EntityIdSchema, checkpointId: EntityIdSchema }),
  event("PAUSE", { checkpointId: EntityIdSchema }),
  event("RESUME", { checkpointId: EntityIdSchema }),
  event("REQUEST_INPUT", { requestId: EntityIdSchema }),
  event("PROVIDE_INPUT", { requestId: EntityIdSchema }),
  event("REQUEST_ACTION_APPROVAL", {
    approvalId: EntityIdSchema,
    actionId: EntityIdSchema,
    actionFingerprint: Sha256Schema,
    tool: z.string().min(1).max(160),
  }),
  event("RESOLVE_ACTION_APPROVAL", {
    approvalId: EntityIdSchema,
    resolution: z.enum(["approved", "rejected", "expired"]),
  }),
  event("DISPATCH_APPROVED_ACTION", {
    approvalId: EntityIdSchema,
    actionId: EntityIdSchema,
    actionFingerprint: Sha256Schema,
  }),
  event("REQUEST_TAKEOVER", { checkpointId: EntityIdSchema }),
  event("RETURN_CONTROL", { snapshotId: EntityIdSchema }),
  event("RECOVERABLE_FAILURE", { failureId: EntityIdSchema, checkpointId: EntityIdSchema }),
  event("RETRY_FROM_CHECKPOINT", { checkpointId: EntityIdSchema }),
  event("FORM_COMPLETE", {}),
  event("REQUEST_CHANGES", {}),
  event("CONFIRM_REVIEW", {
    reviewSnapshotHash: Sha256Schema,
    approvalId: EntityIdSchema,
    actionId: EntityIdSchema,
    actionFingerprint: Sha256Schema,
    tool: z.string().min(1).max(160),
  }),
  event("SUBMIT_APPROVED", {
    approvalId: EntityIdSchema,
    actionId: EntityIdSchema,
    actionFingerprint: Sha256Schema,
    tool: z.string().min(1).max(160),
  }),
  event("SUBMIT_REJECTED_OR_EXPIRED", { approvalId: EntityIdSchema }),
  event("SUBMIT_SUCCEEDED", { receiptArtifactId: EntityIdSchema }),
  event("SUBMIT_FAILED", { failureId: EntityIdSchema }),
  event("CANCEL", { reason: z.string().min(1).max(2_000) }),
  event("FATAL_FAILURE", { failureId: EntityIdSchema }),
]);

export type ApplicationEvent = z.infer<typeof ApplicationEventSchema>;
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;
export type ActionRisk = z.infer<typeof ActionRiskSchema>;

export interface ApplicationMachineState {
  applicationId: string;
  status: ApplicationStatus;
  revision: number;
  processedEventIds: string[];
  processedEventFingerprints: Record<string, string>;
  processedEventEffects: Record<string, DomainEffect[]>;
  browserDispatchDeliveries: Record<string, BrowserDispatchDelivery>;
  runId?: string | undefined;
  checkpointId?: string | undefined;
  checkpointSequence?: number | undefined;
  pendingRequestId?: string | undefined;
  activeApprovalId?: string | undefined;
  pendingActionId?: string | undefined;
  pendingActionFingerprint?: string | undefined;
  pendingActionTool?: string | undefined;
  approvedActionId?: string | undefined;
  approvedActionFingerprint?: string | undefined;
  approvedActionTool?: string | undefined;
  reviewSnapshotHash?: string | undefined;
  submitActionId?: string | undefined;
  submitActionFingerprint?: string | undefined;
  submitActionTool?: string | undefined;
  receiptArtifactId?: string | undefined;
  lastEventAt?: string | undefined;
}

export interface ApplicationTransitionContext {
  now: string;
  resumeFinalized?: boolean;
  referencesValid?: boolean;
  targetOriginAllowed?: boolean;
  runnerAvailable?: boolean;
  checkpointCommitted?: boolean;
  checkpoint?: ApplicationCheckpoint;
  sessionValid?: boolean;
  pageRevalidated?: boolean;
  inputPersisted?: boolean;
  inputPolicyChecked?: boolean;
  approvalPersisted?: boolean;
  approvalActionFingerprint?: string;
  approvalActionTool?: string;
  reviewSnapshotPersisted?: boolean;
  takeoverActionsStopped?: boolean;
  requiredFieldsVerified?: boolean;
  hasBlockingValidationErrors?: boolean;
  approval?: ApprovalRequest;
  submissionResultPersisted?: boolean;
}

interface DomainEffectBase {
  id: string;
  causedByEventId: string;
}

export type DomainEffect = DomainEffectBase &
  (
  | {
      type: "APPEND_AUDIT_EVENT";
      eventType: ApplicationEvent["type"];
      fromStatus: ApplicationStatus;
      toStatus: ApplicationStatus;
      occurredAt: string;
    }
  | {
      type: "CONSUME_APPROVAL";
      approvalId: string;
      actionId: string;
      consumedAt: string;
    }
  | {
      type: "DISPATCH_BROWSER_ACTION";
      approvalId: string;
      actionId: string;
      actionFingerprint: string;
      tool: string;
      risk: "reversible" | "consequential";
      requiresConsumedApprovalId: string;
    }
  | { type: "INVALIDATE_SUBMIT_APPROVAL"; approvalId?: string | undefined }
  | { type: "MANUAL_SUBMISSION_RECONCILIATION"; failureId: string }
  );

type DomainEffectInput = DomainEffect extends infer T
  ? T extends DomainEffect
    ? Omit<T, keyof DomainEffectBase>
    : never
  : never;

export interface TransitionResult<T> {
  state: T;
  effects: DomainEffect[];
  idempotent: boolean;
}

export type BrowserDispatchDeliveryStatus =
  | "pending"
  | "claimed"
  | "recovery_required"
  | "acknowledged"
  | "manual_reconciliation";

export interface BrowserDispatchDelivery {
  effectId: string;
  approvalId: string;
  actionId: string;
  actionFingerprint: string;
  tool: string;
  risk: "reversible" | "consequential";
  status: BrowserDispatchDeliveryStatus;
  claimedBy?: string | undefined;
  claimTokenHash?: string | undefined;
  approvalConsumedAt?: string | undefined;
  claimedAt?: string | undefined;
  resolvedAt?: string | undefined;
}

const terminalStatuses = new Set<ApplicationStatus>([
  "completed",
  "failed_final",
  "cancelled",
]);

function requireGuard(value: boolean | undefined, message: string): asserts value is true {
  if (value !== true) {
    throw new TransitionError("GUARD_FAILED", message);
  }
}

function requireStatus(
  state: ApplicationMachineState,
  eventType: ApplicationEvent["type"],
  ...allowed: ApplicationStatus[]
): void {
  if (!allowed.includes(state.status)) {
    throw new TransitionError(
      "INVALID_TRANSITION",
      `${eventType} is not allowed from ${state.status}.`,
    );
  }
}

function parseTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new TransitionError("GUARD_FAILED", `${label} is not a valid timestamp.`);
  }
  return parsed;
}

function fingerprintEvent(eventValue: ApplicationEvent): string {
  return createHash("sha256").update(JSON.stringify(eventValue)).digest("hex");
}

function requireApprovalScope(
  state: ApplicationMachineState,
  approval: ApprovalRequest | undefined,
  approvalId: string,
  actionId: string,
): ApprovalRequest {
  const parsed = ApprovalRequestSchema.safeParse(approval);
  if (!parsed.success) {
    throw new TransitionError("GUARD_FAILED", "A persisted approval record is required.");
  }
  const persistedApproval = parsed.data;
  if (persistedApproval.id !== approvalId || persistedApproval.actionId !== actionId) {
    throw new TransitionError("GUARD_FAILED", "Approval does not match the requested action.");
  }
  if (
    persistedApproval.applicationId !== state.applicationId ||
    persistedApproval.runId !== state.runId
  ) {
    throw new TransitionError("GUARD_FAILED", "Approval scope does not match this application run.");
  }
  return persistedApproval;
}

function requireCommittedCheckpoint(
  state: ApplicationMachineState,
  checkpointId: string,
  context: ApplicationTransitionContext,
  runId = state.runId,
): ApplicationCheckpoint {
  requireGuard(context.checkpointCommitted, "A durable checkpoint must be committed.");
  const parsed = ApplicationCheckpointSchema.safeParse(context.checkpoint);
  if (!parsed.success) {
    throw new TransitionError("GUARD_FAILED", "A valid checkpoint record is required.");
  }
  const checkpoint = parsed.data;
  if (
    checkpoint.id !== checkpointId ||
    checkpoint.applicationId !== state.applicationId ||
    checkpoint.runId !== runId ||
    checkpoint.stateRevision !== state.revision ||
    checkpoint.status !== state.status
  ) {
    throw new TransitionError(
      "GUARD_FAILED",
      "Checkpoint does not match the current application, run, status, and revision.",
    );
  }
  if (
    state.checkpointSequence !== undefined &&
    checkpoint.sequence <= state.checkpointSequence
  ) {
    throw new TransitionError("GUARD_FAILED", "Checkpoint sequence must increase monotonically.");
  }
  return checkpoint;
}

function requireRestorableCheckpoint(
  state: ApplicationMachineState,
  checkpointId: string,
  context: ApplicationTransitionContext,
): ApplicationCheckpoint {
  const parsed = ApplicationCheckpointSchema.safeParse(context.checkpoint);
  if (!parsed.success) {
    throw new TransitionError("GUARD_FAILED", "A valid checkpoint record is required.");
  }
  const checkpoint = parsed.data;
  if (
    checkpoint.id !== checkpointId ||
    checkpoint.id !== state.checkpointId ||
    checkpoint.applicationId !== state.applicationId ||
    checkpoint.runId !== state.runId ||
    checkpoint.sequence !== state.checkpointSequence ||
    checkpoint.stateRevision !== state.revision - 1 ||
    checkpoint.status !== "running"
  ) {
    throw new TransitionError(
      "GUARD_FAILED",
      "Checkpoint is not the exact predecessor of the current paused or recovery state.",
    );
  }
  requireGuard(context.sessionValid, "Browser session is not valid.");
  return checkpoint;
}

function validateSubmitApproval(
  state: ApplicationMachineState,
  eventValue: Extract<ApplicationEvent, { type: "SUBMIT_APPROVED" }>,
  approval: ApprovalRequest | undefined,
  now: string,
): void {
  const persistedApproval = requireApprovalScope(
    state,
    approval,
    eventValue.approvalId,
    eventValue.actionId,
  );
  if (persistedApproval.status !== "approved") {
    throw new TransitionError("GUARD_FAILED", "A persisted approved approval is required.");
  }
  if (state.activeApprovalId !== eventValue.approvalId) {
    throw new TransitionError("GUARD_FAILED", "Approval is not the active submit approval.");
  }
  if (persistedApproval.reviewSnapshotHash !== state.reviewSnapshotHash) {
    throw new TransitionError("GUARD_FAILED", "Approval is for a stale review snapshot.");
  }
  if (
    parseTime(persistedApproval.expiresAt, "Approval expiry") <=
    parseTime(now, "Current time")
  ) {
    throw new TransitionError("GUARD_FAILED", "Approval has expired.");
  }
}

function materializeEffects(
  eventValue: ApplicationEvent,
  fromStatus: ApplicationStatus,
  toStatus: ApplicationStatus,
  extraEffects: DomainEffectInput[],
): DomainEffect[] {
  const inputs: DomainEffectInput[] = [
    {
      type: "APPEND_AUDIT_EVENT",
      eventType: eventValue.type,
      fromStatus,
      toStatus,
      occurredAt: eventValue.occurredAt,
    },
    ...extraEffects,
  ];
  return inputs.map((effect, index) => ({
    ...effect,
    id: `effect:${createHash("sha256")
      .update(`${eventValue.id}:${index}`)
      .digest("hex")}`,
    causedByEventId: eventValue.id,
  })) as DomainEffect[];
}

function advance(
  state: ApplicationMachineState,
  eventValue: ApplicationEvent,
  status: ApplicationStatus,
  patch: Partial<ApplicationMachineState> = {},
  extraEffects: DomainEffectInput[] = [],
): TransitionResult<ApplicationMachineState> {
  const effects = materializeEffects(eventValue, state.status, status, extraEffects);
  const newDispatchDeliveries = Object.fromEntries(
    effects
      .filter(
        (effect): effect is Extract<DomainEffect, { type: "DISPATCH_BROWSER_ACTION" }> =>
          effect.type === "DISPATCH_BROWSER_ACTION",
      )
      .map((effect) => [
        effect.id,
        {
          effectId: effect.id,
          approvalId: effect.approvalId,
          actionId: effect.actionId,
          actionFingerprint: effect.actionFingerprint,
          tool: effect.tool,
          risk: effect.risk,
          status: "pending" as const,
        },
      ]),
  );
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
      processedEventEffects: {
        ...state.processedEventEffects,
        [eventValue.id]: effects,
      },
      browserDispatchDeliveries: {
        ...state.browserDispatchDeliveries,
        ...newDispatchDeliveries,
      },
      lastEventAt: eventValue.occurredAt,
    },
    effects,
    idempotent: false,
  };
}

export function createApplicationMachineState(applicationId: string): ApplicationMachineState {
  return {
    applicationId: EntityIdSchema.parse(applicationId),
    status: "draft",
    revision: 0,
    processedEventIds: [],
    processedEventFingerprints: {},
    processedEventEffects: {},
    browserDispatchDeliveries: {},
  };
}

export function transitionApplication(
  state: ApplicationMachineState,
  eventInput: ApplicationEvent,
  context: ApplicationTransitionContext,
): TransitionResult<ApplicationMachineState> {
  const eventValue = ApplicationEventSchema.parse(eventInput);

  const eventHash = fingerprintEvent(eventValue);
  const previousEventHash = state.processedEventFingerprints[eventValue.id];
  if (previousEventHash) {
    if (previousEventHash !== eventHash) {
      throw new TransitionError(
        "DUPLICATE_EVENT_CONFLICT",
        `Event ${eventValue.id} was already processed with different content.`,
      );
    }
    return {
      state,
      effects: (state.processedEventEffects[eventValue.id] ?? []).filter((effect) => {
        if (effect.type !== "DISPATCH_BROWSER_ACTION") {
          return true;
        }
        return state.browserDispatchDeliveries[effect.id]?.status === "pending";
      }),
      idempotent: true,
    };
  }
  if (eventValue.expectedRevision !== state.revision) {
    throw new TransitionError(
      "STALE_REVISION",
      `Expected revision ${eventValue.expectedRevision}, current revision is ${state.revision}.`,
    );
  }
  if (terminalStatuses.has(state.status)) {
    throw new TransitionError("INVALID_TRANSITION", `${state.status} is terminal.`);
  }
  if (
    state.lastEventAt &&
    parseTime(eventValue.occurredAt, "Event time") < parseTime(state.lastEventAt, "Previous event time")
  ) {
    throw new TransitionError("GUARD_FAILED", "Event time cannot move backwards.");
  }

  switch (eventValue.type) {
    case "MARK_READY":
      requireStatus(state, eventValue.type, "draft");
      requireGuard(context.resumeFinalized, "A finalized resume is required.");
      requireGuard(context.referencesValid, "Job and profile references must be valid.");
      requireGuard(context.targetOriginAllowed, "Target origin is not allowed.");
      return advance(state, eventValue, "ready");

    case "START_RUN":
      requireStatus(state, eventValue.type, "ready");
      requireGuard(context.runnerAvailable, "A browser runner is required.");
      {
        const checkpoint = requireCommittedCheckpoint(
          state,
          eventValue.checkpointId,
          context,
          eventValue.runId,
        );
      return advance(state, eventValue, "running", {
        runId: eventValue.runId,
        checkpointId: eventValue.checkpointId,
          checkpointSequence: checkpoint.sequence,
      });
      }

    case "PAUSE":
      requireStatus(state, eventValue.type, "running");
      {
        const checkpoint = requireCommittedCheckpoint(state, eventValue.checkpointId, context);
        return advance(state, eventValue, "paused", {
          checkpointId: eventValue.checkpointId,
          checkpointSequence: checkpoint.sequence,
        });
      }

    case "RESUME":
      requireStatus(state, eventValue.type, "paused");
      requireRestorableCheckpoint(state, eventValue.checkpointId, context);
      requireGuard(context.pageRevalidated, "Page must be re-observed before resume.");
      return advance(state, eventValue, "running", { checkpointId: eventValue.checkpointId });

    case "REQUEST_INPUT":
      requireStatus(state, eventValue.type, "running");
      requireGuard(context.inputPersisted, "Pending input request must be persisted.");
      return advance(state, eventValue, "needs_input", { pendingRequestId: eventValue.requestId });

    case "PROVIDE_INPUT":
      requireStatus(state, eventValue.type, "needs_input");
      if (state.pendingRequestId !== eventValue.requestId) {
        throw new TransitionError("GUARD_FAILED", "Input response does not match the pending request.");
      }
      requireGuard(context.inputPersisted, "Input response must be persisted.");
      requireGuard(context.inputPolicyChecked, "Input response must pass policy checks.");
      return advance(state, eventValue, "running", { pendingRequestId: undefined });

    case "REQUEST_ACTION_APPROVAL":
      requireStatus(state, eventValue.type, "running");
      requireGuard(context.approvalPersisted, "Approval request must be persisted.");
      {
        const approval = requireApprovalScope(
          state,
          context.approval,
          eventValue.approvalId,
          eventValue.actionId,
        );
        if (approval.status !== "pending") {
          throw new TransitionError("GUARD_FAILED", "A new action approval must be pending.");
        }
        return advance(state, eventValue, "needs_approval", {
          activeApprovalId: eventValue.approvalId,
          pendingActionId: eventValue.actionId,
          pendingActionFingerprint: eventValue.actionFingerprint,
          pendingActionTool: eventValue.tool,
        });
      }

    case "RESOLVE_ACTION_APPROVAL":
      requireStatus(state, eventValue.type, "needs_approval");
      if (state.activeApprovalId !== eventValue.approvalId) {
        throw new TransitionError("GUARD_FAILED", "Approval resolution does not match the active request.");
      }
      requireGuard(context.approvalPersisted, "Approval resolution must be persisted.");
      if (!state.pendingActionId || !state.pendingActionFingerprint || !state.pendingActionTool) {
        throw new TransitionError("GUARD_FAILED", "The pending action scope is missing.");
      }
      {
        const approval = requireApprovalScope(
          state,
          context.approval,
          eventValue.approvalId,
          state.pendingActionId,
        );
        if (approval.status !== eventValue.resolution) {
          throw new TransitionError("GUARD_FAILED", "Persisted approval status does not match resolution.");
        }
        if (eventValue.resolution === "approved") {
          if (
            context.approvalActionFingerprint !== state.pendingActionFingerprint ||
            context.approvalActionTool !== state.pendingActionTool
          ) {
            throw new TransitionError("GUARD_FAILED", "Approved action content has changed.");
          }
          return advance(state, eventValue, "running", {
            approvedActionId: state.pendingActionId,
            approvedActionFingerprint: state.pendingActionFingerprint,
            approvedActionTool: state.pendingActionTool,
            pendingActionId: undefined,
            pendingActionFingerprint: undefined,
            pendingActionTool: undefined,
          });
        }
        return advance(state, eventValue, "running", {
          activeApprovalId: undefined,
          pendingActionId: undefined,
          pendingActionFingerprint: undefined,
          pendingActionTool: undefined,
          approvedActionId: undefined,
          approvedActionFingerprint: undefined,
          approvedActionTool: undefined,
        });
      }

    case "DISPATCH_APPROVED_ACTION":
      requireStatus(state, eventValue.type, "running");
      if (
        state.activeApprovalId !== eventValue.approvalId ||
        state.approvedActionId !== eventValue.actionId ||
        state.approvedActionFingerprint !== eventValue.actionFingerprint ||
        !state.approvedActionTool
      ) {
        throw new TransitionError("GUARD_FAILED", "Action does not match the one-shot approval grant.");
      }
      {
        const approval = requireApprovalScope(
          state,
          context.approval,
          eventValue.approvalId,
          eventValue.actionId,
        );
        if (approval.status !== "approved") {
          throw new TransitionError("GUARD_FAILED", "Action approval is not approved.");
        }
        if (parseTime(approval.expiresAt, "Approval expiry") <= parseTime(context.now, "Current time")) {
          throw new TransitionError("GUARD_FAILED", "Action approval has expired.");
        }
        return advance(
          state,
          eventValue,
          "running",
          {
            activeApprovalId: undefined,
            approvedActionId: undefined,
            approvedActionFingerprint: undefined,
            approvedActionTool: undefined,
          },
          [
            {
              type: "CONSUME_APPROVAL",
              approvalId: eventValue.approvalId,
              actionId: eventValue.actionId,
              consumedAt: context.now,
            },
            {
              type: "DISPATCH_BROWSER_ACTION",
              approvalId: eventValue.approvalId,
              actionId: eventValue.actionId,
              actionFingerprint: eventValue.actionFingerprint,
              tool: state.approvedActionTool,
              risk: "reversible",
              requiresConsumedApprovalId: eventValue.approvalId,
            },
          ],
        );
      }

    case "REQUEST_TAKEOVER":
      requireStatus(state, eventValue.type, "running");
      requireGuard(context.takeoverActionsStopped, "Agent browser actions must be stopped.");
      {
        const checkpoint = requireCommittedCheckpoint(state, eventValue.checkpointId, context);
        return advance(state, eventValue, "user_takeover", {
          checkpointId: eventValue.checkpointId,
          checkpointSequence: checkpoint.sequence,
        });
      }

    case "RETURN_CONTROL":
      requireStatus(state, eventValue.type, "user_takeover");
      requireGuard(context.targetOriginAllowed, "Current origin is not allowed.");
      requireGuard(context.pageRevalidated, "A fresh snapshot is required.");
      return advance(state, eventValue, "running");

    case "RECOVERABLE_FAILURE":
      requireStatus(state, eventValue.type, "running");
      {
        const checkpoint = requireCommittedCheckpoint(state, eventValue.checkpointId, context);
        return advance(state, eventValue, "failed_recoverable", {
          checkpointId: eventValue.checkpointId,
          checkpointSequence: checkpoint.sequence,
        });
      }

    case "RETRY_FROM_CHECKPOINT":
      requireStatus(state, eventValue.type, "failed_recoverable");
      requireRestorableCheckpoint(state, eventValue.checkpointId, context);
      requireGuard(context.pageRevalidated, "Page must be re-observed before retry.");
      return advance(state, eventValue, "running", { checkpointId: eventValue.checkpointId });

    case "FORM_COMPLETE":
      requireStatus(state, eventValue.type, "running");
      requireGuard(context.requiredFieldsVerified, "Required fields have not been verified.");
      if (context.hasBlockingValidationErrors !== false) {
        throw new TransitionError("GUARD_FAILED", "Blocking validation errors remain.");
      }
      return advance(state, eventValue, "review");

    case "REQUEST_CHANGES":
      requireStatus(state, eventValue.type, "review", "awaiting_submit_approval");
      return advance(
        state,
        eventValue,
        "running",
        {
          reviewSnapshotHash: undefined,
          activeApprovalId: undefined,
          submitActionId: undefined,
          submitActionFingerprint: undefined,
          submitActionTool: undefined,
        },
        [{ type: "INVALIDATE_SUBMIT_APPROVAL", approvalId: state.activeApprovalId }],
      );

    case "CONFIRM_REVIEW":
      requireStatus(state, eventValue.type, "review");
      requireGuard(context.reviewSnapshotPersisted, "Review snapshot must be persisted.");
      requireGuard(context.approvalPersisted, "Submit approval request must be persisted.");
      {
        const pendingApproval = requireApprovalScope(
          state,
          context.approval,
          eventValue.approvalId,
          eventValue.actionId,
        );
      if (
          pendingApproval.status !== "pending" ||
          pendingApproval.reviewSnapshotHash !== eventValue.reviewSnapshotHash ||
          parseTime(pendingApproval.expiresAt, "Approval expiry") <=
            parseTime(context.now, "Current time")
      ) {
        throw new TransitionError(
          "GUARD_FAILED",
          "Pending submit approval does not match the review snapshot and application run.",
        );
      }
      if (
        context.approvalActionFingerprint !== eventValue.actionFingerprint ||
        context.approvalActionTool !== eventValue.tool
      ) {
        throw new TransitionError(
          "GUARD_FAILED",
          "Submit approval must bind the immutable action fingerprint and tool.",
        );
      }
      return advance(state, eventValue, "awaiting_submit_approval", {
        reviewSnapshotHash: eventValue.reviewSnapshotHash,
        activeApprovalId: eventValue.approvalId,
        submitActionId: eventValue.actionId,
        submitActionFingerprint: eventValue.actionFingerprint,
        submitActionTool: eventValue.tool,
      });
      }

    case "SUBMIT_APPROVED":
      requireStatus(state, eventValue.type, "awaiting_submit_approval");
      validateSubmitApproval(state, eventValue, context.approval, context.now);
      if (
        state.submitActionId !== eventValue.actionId ||
        state.submitActionFingerprint !== eventValue.actionFingerprint ||
        state.submitActionTool !== eventValue.tool ||
        context.approvalActionFingerprint !== eventValue.actionFingerprint ||
        context.approvalActionTool !== eventValue.tool
      ) {
        throw new TransitionError("GUARD_FAILED", "Approved submission action content has changed.");
      }
      return advance(
        state,
        eventValue,
        "submitting",
        {
          activeApprovalId: eventValue.approvalId,
          submitActionId: eventValue.actionId,
          submitActionFingerprint: eventValue.actionFingerprint,
          submitActionTool: eventValue.tool,
        },
        [
          {
            type: "CONSUME_APPROVAL",
            approvalId: eventValue.approvalId,
            actionId: eventValue.actionId,
            consumedAt: context.now,
          },
          {
            type: "DISPATCH_BROWSER_ACTION",
            approvalId: eventValue.approvalId,
            actionId: eventValue.actionId,
            actionFingerprint: eventValue.actionFingerprint,
            tool: eventValue.tool,
            risk: "consequential",
            requiresConsumedApprovalId: eventValue.approvalId,
          },
        ],
      );

    case "SUBMIT_REJECTED_OR_EXPIRED":
      requireStatus(state, eventValue.type, "awaiting_submit_approval");
      if (state.activeApprovalId !== eventValue.approvalId) {
        throw new TransitionError("GUARD_FAILED", "Resolution is for a different submit approval.");
      }
      requireGuard(context.approvalPersisted, "Approval resolution must be persisted.");
      if (!state.submitActionId || !state.reviewSnapshotHash) {
        throw new TransitionError("GUARD_FAILED", "Stored submit approval scope is missing.");
      }
      {
        const persistedApproval = requireApprovalScope(
          state,
          context.approval,
          eventValue.approvalId,
          state.submitActionId,
        );
        if (
          !["rejected", "expired"].includes(persistedApproval.status) ||
          persistedApproval.reviewSnapshotHash !== state.reviewSnapshotHash
        ) {
          throw new TransitionError(
            "GUARD_FAILED",
            "Submit approval is not persistently rejected or expired for this snapshot.",
          );
        }
        if (
          persistedApproval.status === "expired" &&
          parseTime(persistedApproval.expiredAt, "Approval expiration decision") >
            parseTime(context.now, "Current time")
        ) {
          throw new TransitionError("GUARD_FAILED", "Approval expiration is in the future.");
        }
      return advance(state, eventValue, "review", {
        activeApprovalId: undefined,
        reviewSnapshotHash: undefined,
        submitActionId: undefined,
        submitActionFingerprint: undefined,
        submitActionTool: undefined,
      });
      }

    case "SUBMIT_SUCCEEDED":
      requireStatus(state, eventValue.type, "submitting");
      requireGuard(context.submissionResultPersisted, "Submission receipt must be persisted.");
      return advance(state, eventValue, "completed", {
        receiptArtifactId: eventValue.receiptArtifactId,
      });

    case "SUBMIT_FAILED":
      requireStatus(state, eventValue.type, "submitting");
      requireGuard(context.submissionResultPersisted, "Submission failure must be persisted.");
      return advance(
        state,
        eventValue,
        "failed_final",
        {},
        [{ type: "MANUAL_SUBMISSION_RECONCILIATION", failureId: eventValue.failureId }],
      );

    case "CANCEL":
      if (state.status === "submitting") {
        throw new TransitionError("INVALID_TRANSITION", "Cannot cancel an in-flight submission.");
      }
      return advance(state, eventValue, "cancelled");

    case "FATAL_FAILURE":
      return advance(
        state,
        eventValue,
        "failed_final",
        {},
        state.status === "submitting"
          ? [{ type: "MANUAL_SUBMISSION_RECONCILIATION", failureId: eventValue.failureId }]
          : [],
      );
  }

  throw new TransitionError("INVALID_TRANSITION", "Unknown application event.");
}

export interface BrowserActionGateInput {
  status: ApplicationStatus;
  risk: ActionRisk;
  tool: string;
  actionId: string;
  actionFingerprint: string;
  approvalRequired?: boolean;
  dispatchEffect?: DomainEffect;
  dispatchDelivery?: BrowserDispatchDelivery;
  workerId?: string;
  claimToken?: string;
}

const ClaimBrowserDispatchSchema = z
  .object({
    effectId: EntityIdSchema,
    workerId: EntityIdSchema,
    claimTokenHash: Sha256Schema,
    consumedApproval: ApprovalRequestSchema,
    expectedRevision: z.number().int().nonnegative(),
    claimedAt: IsoDateTimeSchema,
  })
  .strict();

const ResolveBrowserDispatchSchema = z
  .object({
    effectId: EntityIdSchema,
    workerId: EntityIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    resolution: z.enum(["verified_applied", "verified_not_applied", "uncertain"]),
    resolvedAt: IsoDateTimeSchema,
  })
  .strict();

const RecoverStaleBrowserDispatchSchema = z
  .object({
    effectId: EntityIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    recoveredAt: IsoDateTimeSchema,
  })
  .strict();

function findBrowserDispatchEffect(
  state: ApplicationMachineState,
  effectId: string,
): Extract<DomainEffect, { type: "DISPATCH_BROWSER_ACTION" }> | undefined {
  for (const effects of Object.values(state.processedEventEffects)) {
    const effect = effects.find(
      (candidate): candidate is Extract<DomainEffect, { type: "DISPATCH_BROWSER_ACTION" }> =>
        candidate.id === effectId && candidate.type === "DISPATCH_BROWSER_ACTION",
    );
    if (effect) {
      return effect;
    }
  }
  return undefined;
}

export interface BrowserDispatchClaimResult {
  state: ApplicationMachineState;
  effect: Extract<DomainEffect, { type: "DISPATCH_BROWSER_ACTION" }>;
  delivery: BrowserDispatchDelivery;
}

export function claimBrowserDispatch(
  state: ApplicationMachineState,
  input: z.input<typeof ClaimBrowserDispatchSchema>,
): BrowserDispatchClaimResult {
  const value = ClaimBrowserDispatchSchema.parse(input);
  if (value.expectedRevision !== state.revision) {
    throw new TransitionError("STALE_REVISION", "Browser dispatch claim revision is stale.");
  }
  if (state.lastEventAt && parseTime(value.claimedAt, "Claim time") < parseTime(state.lastEventAt, "Previous event time")) {
    throw new TransitionError("GUARD_FAILED", "Browser dispatch claim time cannot move backwards.");
  }
  const effect = findBrowserDispatchEffect(state, value.effectId);
  const current = state.browserDispatchDeliveries[value.effectId];
  if (!effect || !current) {
    throw new TransitionError("GUARD_FAILED", "Browser dispatch effect does not exist.");
  }
  if (current.status !== "pending") {
    throw new TransitionError(
      "INVALID_TRANSITION",
      `Browser dispatch ${value.effectId} is already ${current.status}.`,
    );
  }
  const consumedApproval = value.consumedApproval;
  if (
    consumedApproval.status !== "consumed" ||
    consumedApproval.id !== effect.approvalId ||
    consumedApproval.applicationId !== state.applicationId ||
    consumedApproval.runId !== state.runId ||
    consumedApproval.actionId !== effect.actionId ||
    consumedApproval.consumedBy !== effect.actionId ||
    effect.requiresConsumedApprovalId !== consumedApproval.id
  ) {
    throw new TransitionError(
      "GUARD_FAILED",
      "The persisted exact approval must be consumed by this action before claim.",
    );
  }
  const delivery: BrowserDispatchDelivery = {
    ...current,
    status: "claimed",
    claimedBy: value.workerId,
    claimTokenHash: value.claimTokenHash,
    approvalConsumedAt: consumedApproval.consumedAt,
    claimedAt: value.claimedAt,
  };
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      lastEventAt: value.claimedAt,
      browserDispatchDeliveries: {
        ...state.browserDispatchDeliveries,
        [value.effectId]: delivery,
      },
    },
    effect,
    delivery,
  };
}

export interface BrowserDispatchResolutionResult {
  state: ApplicationMachineState;
  delivery: BrowserDispatchDelivery;
}

export function resolveBrowserDispatch(
  state: ApplicationMachineState,
  input: z.input<typeof ResolveBrowserDispatchSchema>,
): BrowserDispatchResolutionResult {
  const value = ResolveBrowserDispatchSchema.parse(input);
  if (value.expectedRevision !== state.revision) {
    throw new TransitionError("STALE_REVISION", "Browser dispatch resolution revision is stale.");
  }
  if (state.lastEventAt && parseTime(value.resolvedAt, "Resolution time") < parseTime(state.lastEventAt, "Previous event time")) {
    throw new TransitionError("GUARD_FAILED", "Browser dispatch resolution time cannot move backwards.");
  }
  const current = state.browserDispatchDeliveries[value.effectId];
  if (!current || !["claimed", "recovery_required"].includes(current.status)) {
    throw new TransitionError("INVALID_TRANSITION", "Browser dispatch is not awaiting resolution.");
  }
  if (current.status === "claimed" && current.claimedBy !== value.workerId) {
    throw new TransitionError("GUARD_FAILED", "Only the claiming worker may report its outcome.");
  }

  let status: BrowserDispatchDeliveryStatus;
  if (value.resolution === "verified_applied") {
    status = "acknowledged";
  } else if (current.risk === "consequential") {
    status = "manual_reconciliation";
  } else if (value.resolution === "verified_not_applied") {
    status = "pending";
  } else {
    status = "recovery_required";
  }

  const delivery: BrowserDispatchDelivery = {
    ...current,
    status,
    resolvedAt: value.resolvedAt,
    ...(status === "pending"
      ? { claimedBy: undefined, claimTokenHash: undefined, claimedAt: undefined }
      : {}),
  };
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      lastEventAt: value.resolvedAt,
      browserDispatchDeliveries: {
        ...state.browserDispatchDeliveries,
        [value.effectId]: delivery,
      },
    },
    delivery,
  };
}

export function recoverStaleBrowserDispatch(
  state: ApplicationMachineState,
  input: z.input<typeof RecoverStaleBrowserDispatchSchema>,
): BrowserDispatchResolutionResult {
  const value = RecoverStaleBrowserDispatchSchema.parse(input);
  if (value.expectedRevision !== state.revision) {
    throw new TransitionError("STALE_REVISION", "Browser dispatch recovery revision is stale.");
  }
  if (
    state.lastEventAt &&
    parseTime(value.recoveredAt, "Recovery time") <
      parseTime(state.lastEventAt, "Previous event time")
  ) {
    throw new TransitionError("GUARD_FAILED", "Browser dispatch recovery time cannot move backwards.");
  }
  const current = state.browserDispatchDeliveries[value.effectId];
  if (!current || current.status !== "claimed") {
    throw new TransitionError("INVALID_TRANSITION", "Only an abandoned claimed dispatch can recover.");
  }
  const delivery: BrowserDispatchDelivery = {
    ...current,
    status:
      current.risk === "consequential"
        ? "manual_reconciliation"
        : "recovery_required",
    resolvedAt: value.recoveredAt,
  };
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      lastEventAt: value.recoveredAt,
      browserDispatchDeliveries: {
        ...state.browserDispatchDeliveries,
        [value.effectId]: delivery,
      },
    },
    delivery,
  };
}

export function canExecuteBrowserAction(input: BrowserActionGateInput): boolean {
  if (input.risk === "read_only") {
    return input.status === "running" || input.status === "review";
  }
  if (input.risk === "reversible") {
    if (input.status !== "running") {
      return false;
    }
    if (input.approvalRequired !== true) {
      return true;
    }
  }
  if (input.risk === "takeover") {
    return false;
  }
  if (input.risk === "consequential" && input.status !== "submitting") {
    return false;
  }

  const effect = input.dispatchEffect;
  const delivery = input.dispatchDelivery;
  const claimTokenHash = input.claimToken
    ? createHash("sha256").update(input.claimToken).digest("hex")
    : undefined;
  return (
    input.workerId !== undefined &&
    claimTokenHash !== undefined &&
    effect?.type === "DISPATCH_BROWSER_ACTION" &&
    effect.risk === input.risk &&
    effect.actionId === input.actionId &&
    effect.actionFingerprint === input.actionFingerprint &&
    effect.tool === input.tool &&
    effect.requiresConsumedApprovalId === effect.approvalId &&
    delivery?.effectId === effect.id &&
    delivery.status === "claimed" &&
    delivery.claimedBy === input.workerId &&
    delivery.claimTokenHash === claimTokenHash &&
    delivery.approvalConsumedAt !== undefined &&
    delivery.approvalId === effect.approvalId &&
    delivery.actionId === effect.actionId &&
    delivery.actionFingerprint === effect.actionFingerprint
  );
}

export function parseApproval(value: unknown): ApprovalRequest {
  return ApprovalRequestSchema.parse(value);
}
