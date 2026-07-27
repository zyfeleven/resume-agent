import type { ApplicationCheckpoint, ApprovalRequest } from "@resume-agent/contracts";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  TransitionError,
  canExecuteBrowserAction,
  claimBrowserDispatch,
  createApplicationMachineState,
  recoverStaleBrowserDispatch,
  transitionApplication,
  type ApplicationEvent,
  type ApplicationMachineState,
  type ApplicationTransitionContext,
  type DomainEffect,
} from "../src/index.js";

const now = "2026-07-26T16:00:00-04:00";
const later = "2026-07-26T16:10:00-04:00";
const hash = "a".repeat(64);
const actionHash = "b".repeat(64);
const claimToken = "claim-token-kept-only-by-worker-1";
const claimTokenHash = createHash("sha256").update(claimToken).digest("hex");

type ApplicationEventInput<T extends ApplicationEvent = ApplicationEvent> =
  T extends ApplicationEvent ? Omit<T, "expectedRevision" | "occurredAt"> : never;

function apply(
  state: ApplicationMachineState,
  event: ApplicationEventInput,
  context: ApplicationTransitionContext = { now },
) {
  return transitionApplication(
    state,
    { ...event, expectedRevision: state.revision, occurredAt: now } as ApplicationEvent,
    context,
  );
}

function checkpoint(
  state: ApplicationMachineState,
  id: string,
  sequence: number,
  overrides: Partial<ApplicationCheckpoint> = {},
): ApplicationCheckpoint {
  return {
    id,
    applicationId: state.applicationId,
    runId: state.runId ?? "run:1",
    sequence,
    stateRevision: state.revision,
    status: state.status,
    browserSessionRef: "browser-session:1",
    allowedOrigin: "https://jobs.example.com",
    url: "https://jobs.example.com/apply",
    pageFingerprint: hash,
    completedActionIds: [],
    fieldDecisionIds: [],
    artifactIds: [],
    lastAuditEventHash: "c".repeat(64),
    createdAt: now,
    ...overrides,
  };
}

function approval(
  state: ApplicationMachineState,
  id: string,
  actionId: string,
  status: "pending" | "approved" | "rejected" | "expired" | "consumed" = "approved",
  overrides: Record<string, unknown> = {},
): ApprovalRequest {
  const base = {
    id,
    applicationId: state.applicationId,
    runId: state.runId ?? "run:1",
    actionId,
    reason: "User reviewed this action",
    reviewSnapshotHash: hash,
    expiresAt: later,
    createdAt: now,
    updatedAt: now,
  };
  if (status === "pending") {
    return { ...base, status, ...overrides } as ApprovalRequest;
  }
  if (status === "expired") {
    return { ...base, status, expiredAt: now, ...overrides } as ApprovalRequest;
  }
  if (status === "consumed") {
    return {
      ...base,
      status,
      decision: { decidedBy: "user:1", decidedAt: now },
      consumedBy: actionId,
      consumedAt: now,
      ...overrides,
    } as ApprovalRequest;
  }
  return {
    ...base,
    status,
    decision: { decidedBy: "user:1", decidedAt: now },
    ...overrides,
  } as ApprovalRequest;
}

function runningState(): ApplicationMachineState {
  let state = createApplicationMachineState("application:1");
  state = apply(
    state,
    { id: "event:ready", type: "MARK_READY" },
    { now, resumeFinalized: true, referencesValid: true, targetOriginAllowed: true },
  ).state;
  const initialCheckpoint = checkpoint(state, "checkpoint:0", 0, { runId: "run:1" });
  return apply(
    state,
    { id: "event:start", type: "START_RUN", runId: "run:1", checkpointId: initialCheckpoint.id },
    {
      now,
      runnerAvailable: true,
      checkpointCommitted: true,
      checkpoint: initialCheckpoint,
    },
  ).state;
}

function reviewState(): ApplicationMachineState {
  const state = runningState();
  return apply(
    state,
    { id: "event:complete", type: "FORM_COMPLETE" },
    { now, requiredFieldsVerified: true, hasBlockingValidationErrors: false },
  ).state;
}

function awaitingSubmitState(): ApplicationMachineState {
  const state = reviewState();
  const pendingApproval = approval(state, "approval:submit", "action:submit", "pending");
  return apply(
    state,
    {
      id: "event:review",
      type: "CONFIRM_REVIEW",
      reviewSnapshotHash: hash,
      approvalId: pendingApproval.id,
      actionId: pendingApproval.actionId,
      actionFingerprint: actionHash,
      tool: "form_submit",
    },
    {
      now,
      reviewSnapshotPersisted: true,
      approvalPersisted: true,
      approval: pendingApproval,
      approvalActionFingerprint: actionHash,
      approvalActionTool: "form_submit",
    },
  ).state;
}

describe("application state machine", () => {
  it("supports durable pause, input, takeover, recovery, review, and approved submission", () => {
    let state = runningState();
    const pauseCheckpoint = checkpoint(state, "checkpoint:1", 1);
    state = apply(
      state,
      { id: "event:pause", type: "PAUSE", checkpointId: pauseCheckpoint.id },
      { now, checkpointCommitted: true, checkpoint: pauseCheckpoint },
    ).state;
    expect(state.status).toBe("paused");

    state = apply(
      state,
      { id: "event:resume", type: "RESUME", checkpointId: pauseCheckpoint.id },
      { now, checkpoint: pauseCheckpoint, sessionValid: true, pageRevalidated: true },
    ).state;
    state = apply(
      state,
      { id: "event:input-request", type: "REQUEST_INPUT", requestId: "input:1" },
      { now, inputPersisted: true },
    ).state;
    state = apply(
      state,
      { id: "event:input", type: "PROVIDE_INPUT", requestId: "input:1" },
      { now, inputPersisted: true, inputPolicyChecked: true },
    ).state;

    const takeoverCheckpoint = checkpoint(state, "checkpoint:2", 2);
    state = apply(
      state,
      { id: "event:takeover", type: "REQUEST_TAKEOVER", checkpointId: takeoverCheckpoint.id },
      {
        now,
        takeoverActionsStopped: true,
        checkpointCommitted: true,
        checkpoint: takeoverCheckpoint,
      },
    ).state;
    state = apply(
      state,
      { id: "event:return", type: "RETURN_CONTROL", snapshotId: "snapshot:1" },
      { now, targetOriginAllowed: true, pageRevalidated: true },
    ).state;

    const recoveryCheckpoint = checkpoint(state, "checkpoint:3", 3);
    state = apply(
      state,
      {
        id: "event:failure",
        type: "RECOVERABLE_FAILURE",
        failureId: "failure:1",
        checkpointId: recoveryCheckpoint.id,
      },
      { now, checkpointCommitted: true, checkpoint: recoveryCheckpoint },
    ).state;
    state = apply(
      state,
      { id: "event:retry", type: "RETRY_FROM_CHECKPOINT", checkpointId: recoveryCheckpoint.id },
      { now, checkpoint: recoveryCheckpoint, sessionValid: true, pageRevalidated: true },
    ).state;
    state = apply(
      state,
      { id: "event:complete", type: "FORM_COMPLETE" },
      { now, requiredFieldsVerified: true, hasBlockingValidationErrors: false },
    ).state;

    const pendingApproval = approval(state, "approval:submit", "action:submit", "pending");
    state = apply(
      state,
      {
        id: "event:review",
        type: "CONFIRM_REVIEW",
        reviewSnapshotHash: hash,
        approvalId: pendingApproval.id,
        actionId: pendingApproval.actionId,
        actionFingerprint: actionHash,
        tool: "form_submit",
      },
      {
        now,
        reviewSnapshotPersisted: true,
        approvalPersisted: true,
        approval: pendingApproval,
        approvalActionFingerprint: actionHash,
        approvalActionTool: "form_submit",
      },
    ).state;

    const submitResult = apply(
      state,
      {
        id: "event:submit-approved",
        type: "SUBMIT_APPROVED",
        approvalId: "approval:submit",
        actionId: "action:submit",
        actionFingerprint: actionHash,
        tool: "form_submit",
      },
      {
        now,
        approval: approval(state, "approval:submit", "action:submit"),
        approvalActionFingerprint: actionHash,
        approvalActionTool: "form_submit",
      },
    );
    const dispatch = submitResult.effects.find(
      (effect): effect is Extract<DomainEffect, { type: "DISPATCH_BROWSER_ACTION" }> =>
        effect.type === "DISPATCH_BROWSER_ACTION",
    );
    expect(dispatch?.risk).toBe("consequential");
    state = submitResult.state;
    state = apply(
      state,
      { id: "event:success", type: "SUBMIT_SUCCEEDED", receiptArtifactId: "artifact:receipt" },
      { now, submissionResultPersisted: true },
    ).state;

    expect(state.status).toBe("completed");
    expect(state.receiptArtifactId).toBe("artifact:receipt");
  });

  it("rejects skipped, stale, backwards-time, and terminal transitions", () => {
    const draft = createApplicationMachineState("application:1");
    expect(() =>
      transitionApplication(
        draft,
        {
          id: "event:start",
          type: "START_RUN",
          runId: "run:1",
          checkpointId: "checkpoint:0",
          expectedRevision: 0,
          occurredAt: now,
        },
        { now, runnerAvailable: true },
      ),
    ).toThrowError(TransitionError);
    expect(() =>
      transitionApplication(
        draft,
        { id: "event:ready", type: "MARK_READY", expectedRevision: 2, occurredAt: now },
        { now, resumeFinalized: true, referencesValid: true, targetOriginAllowed: true },
      ),
    ).toThrowError(/revision/i);

    const cancelled = apply(
      runningState(),
      { id: "event:cancel", type: "CANCEL", reason: "User cancelled" },
    ).state;
    expect(() =>
      transitionApplication(
        cancelled,
        {
          id: "event:after-terminal",
          type: "CANCEL",
          reason: "Again",
          expectedRevision: cancelled.revision,
          occurredAt: now,
        },
        { now },
      ),
    ).toThrowError(/terminal/i);

    const current = runningState();
    expect(() =>
      transitionApplication(
        { ...current, lastEventAt: later },
        {
          id: "event:old",
          type: "CANCEL",
          reason: "Old event",
          expectedRevision: current.revision,
          occurredAt: now,
        },
        { now: later },
      ),
    ).toThrowError(/backwards/i);
  });

  it("re-emits deterministic effects for an idempotent event replay", () => {
    const initial = createApplicationMachineState("application:1");
    const event: ApplicationEvent = {
      id: "event:ready",
      type: "MARK_READY",
      expectedRevision: 0,
      occurredAt: now,
    };
    const first = transitionApplication(initial, event, {
      now,
      resumeFinalized: true,
      referencesValid: true,
      targetOriginAllowed: true,
    });
    const duplicate = transitionApplication(first.state, event, { now });

    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.state).toEqual(first.state);
    expect(duplicate.effects).toEqual(first.effects);
    expect(duplicate.effects[0]?.id).toMatch(/^effect:[a-f0-9]{64}$/);
  });

  it("rejects duplicate event IDs with different content", () => {
    const initial = createApplicationMachineState("application:1");
    const first = transitionApplication(
      initial,
      { id: "event:ready", type: "MARK_READY", expectedRevision: 0, occurredAt: now },
      { now, resumeFinalized: true, referencesValid: true, targetOriginAllowed: true },
    );

    expect(() =>
      transitionApplication(
        first.state,
        {
          id: "event:ready",
          type: "CANCEL",
          reason: "Conflicting replay",
          expectedRevision: first.state.revision,
          occurredAt: now,
        },
        { now },
      ),
    ).toThrowError(/different content/i);
  });

  it("requires the exact persisted checkpoint and a valid session for resume and retry", () => {
    const running = runningState();
    const pauseCheckpoint = checkpoint(running, "checkpoint:1", 1);
    const paused = apply(
      running,
      { id: "event:pause", type: "PAUSE", checkpointId: pauseCheckpoint.id },
      { now, checkpointCommitted: true, checkpoint: pauseCheckpoint },
    ).state;

    expect(() =>
      apply(
        paused,
        { id: "event:resume-wrong", type: "RESUME", checkpointId: pauseCheckpoint.id },
        {
          now,
          checkpoint: { ...pauseCheckpoint, runId: "run:other" },
          sessionValid: true,
          pageRevalidated: true,
        },
      ),
    ).toThrowError(/exact predecessor/i);
    expect(() =>
      apply(
        paused,
        { id: "event:resume-session", type: "RESUME", checkpointId: pauseCheckpoint.id },
        { now, checkpoint: pauseCheckpoint, sessionValid: false, pageRevalidated: true },
      ),
    ).toThrowError(/session/i);
  });

  it("issues a one-shot grant only for an approved exact action", () => {
    let state = runningState();
    const pending = approval(state, "approval:fill", "action:fill", "pending");
    state = apply(
      state,
      {
        id: "event:request-approval",
        type: "REQUEST_ACTION_APPROVAL",
        approvalId: pending.id,
        actionId: pending.actionId,
        actionFingerprint: actionHash,
        tool: "form_fill",
      },
      { now, approvalPersisted: true, approval: pending },
    ).state;

    const rejected = apply(
      state,
      {
        id: "event:reject-action",
        type: "RESOLVE_ACTION_APPROVAL",
        approvalId: pending.id,
        resolution: "rejected",
      },
      {
        now,
        approvalPersisted: true,
        approval: approval(state, pending.id, pending.actionId, "rejected"),
      },
    ).state;
    expect(rejected.approvedActionId).toBeUndefined();
    expect(() =>
      apply(
        rejected,
        {
          id: "event:dispatch-rejected",
          type: "DISPATCH_APPROVED_ACTION",
          approvalId: pending.id,
          actionId: pending.actionId,
          actionFingerprint: actionHash,
        },
        { now, approval: approval(rejected, pending.id, pending.actionId) },
      ),
    ).toThrowError(/one-shot/i);

    let approvedState = runningState();
    const pendingApproved = approval(approvedState, "approval:fill-2", "action:fill-2", "pending");
    approvedState = apply(
      approvedState,
      {
        id: "event:request-approval-2",
        type: "REQUEST_ACTION_APPROVAL",
        approvalId: pendingApproved.id,
        actionId: pendingApproved.actionId,
        actionFingerprint: actionHash,
        tool: "form_fill",
      },
      { now, approvalPersisted: true, approval: pendingApproved },
    ).state;
    approvedState = apply(
      approvedState,
      {
        id: "event:approve-action",
        type: "RESOLVE_ACTION_APPROVAL",
        approvalId: pendingApproved.id,
        resolution: "approved",
      },
      {
        now,
        approvalPersisted: true,
        approval: approval(approvedState, pendingApproved.id, pendingApproved.actionId),
        approvalActionFingerprint: actionHash,
        approvalActionTool: "form_fill",
      },
    ).state;
    const dispatched = apply(
      approvedState,
      {
        id: "event:dispatch-approved",
        type: "DISPATCH_APPROVED_ACTION",
        approvalId: pendingApproved.id,
        actionId: pendingApproved.actionId,
        actionFingerprint: actionHash,
      },
      { now, approval: approval(approvedState, pendingApproved.id, pendingApproved.actionId) },
    );
    expect(dispatched.state.approvedActionId).toBeUndefined();
    expect(dispatched.effects.map((effect) => effect.type)).toEqual([
      "APPEND_AUDIT_EVENT",
      "CONSUME_APPROVAL",
      "DISPATCH_BROWSER_ACTION",
    ]);
  });

  it("rejects rejected, consumed, wrong-scope, stale-snapshot, and expired submit approvals", () => {
    const state = awaitingSubmitState();
    const submitEvent: ApplicationEvent = {
      id: "event:submit",
      type: "SUBMIT_APPROVED",
      approvalId: "approval:submit",
      actionId: "action:submit",
      actionFingerprint: actionHash,
      tool: "form_submit",
      expectedRevision: state.revision,
      occurredAt: now,
    };
    const invalidApprovals = [
      approval(state, "approval:submit", "action:submit", "rejected"),
      approval(state, "approval:submit", "action:submit", "consumed"),
      approval(state, "approval:submit", "action:submit", "approved", {
        applicationId: "application:other",
      }),
      approval(state, "approval:submit", "action:other"),
      approval(state, "approval:submit", "action:submit", "approved", {
        reviewSnapshotHash: "d".repeat(64),
      }),
      approval(state, "approval:submit", "action:submit", "approved", { expiresAt: now }),
    ];

    for (const invalidApproval of invalidApprovals) {
      expect(() =>
        transitionApplication(state, submitEvent, {
          now,
          approval: invalidApproval,
          approvalActionFingerprint: actionHash,
          approvalActionTool: "form_submit",
        }),
      ).toThrowError(TransitionError);
    }
  });

  it("accepts submit rejection only from the exact persisted rejected or expired approval", () => {
    const state = awaitingSubmitState();
    const event: ApplicationEventInput = {
      id: "event:submit-rejected",
      type: "SUBMIT_REJECTED_OR_EXPIRED",
      approvalId: "approval:submit",
    };

    expect(() =>
      apply(state, event, {
        now,
        approvalPersisted: true,
        approval: approval(state, "approval:submit", "action:submit", "pending"),
      }),
    ).toThrowError(/not persistently rejected/i);
    expect(() =>
      apply(state, event, {
        now,
        approvalPersisted: true,
        approval: approval(state, "approval:submit", "action:submit", "rejected", {
          runId: "run:other",
        }),
      }),
    ).toThrowError(/scope/i);

    const rejected = apply(state, event, {
      now,
      approvalPersisted: true,
      approval: approval(state, "approval:submit", "action:submit", "rejected"),
    });
    expect(rejected.state.status).toBe("review");
    expect(rejected.state.submitActionFingerprint).toBeUndefined();
  });

  it("invalidates reviewed approval after changes and blocks cancellation during submission", () => {
    const awaiting = awaitingSubmitState();
    const changed = apply(
      awaiting,
      { id: "event:change", type: "REQUEST_CHANGES" },
      { now },
    );
    expect(changed.state.status).toBe("running");
    expect(changed.state.reviewSnapshotHash).toBeUndefined();
    expect(changed.effects.some((effect) => effect.type === "INVALIDATE_SUBMIT_APPROVAL")).toBe(true);

    const submitting = apply(
      awaiting,
      {
        id: "event:submit-approved",
        type: "SUBMIT_APPROVED",
        approvalId: "approval:submit",
        actionId: "action:submit",
        actionFingerprint: actionHash,
        tool: "form_submit",
      },
      {
        now,
        approval: approval(awaiting, "approval:submit", "action:submit"),
        approvalActionFingerprint: actionHash,
        approvalActionTool: "form_submit",
      },
    ).state;
    expect(() =>
      apply(submitting, { id: "event:cancel-submit", type: "CANCEL", reason: "Too late" }),
    ).toThrowError(/in-flight/i);
  });

  it("gates approved browser actions by exact action fingerprint and consumed approval", () => {
    expect(
      canExecuteBrowserAction({
        status: "running",
        risk: "reversible",
        tool: "form_fill",
        actionId: "action:auto",
        actionFingerprint: actionHash,
      }),
    ).toBe(true);
    expect(
      canExecuteBrowserAction({
        status: "user_takeover",
        risk: "takeover",
        tool: "solve_captcha",
        actionId: "action:captcha",
        actionFingerprint: actionHash,
      }),
    ).toBe(false);

    const awaiting = awaitingSubmitState();
    const submit = apply(
      awaiting,
      {
        id: "event:submit-gate",
        type: "SUBMIT_APPROVED",
        approvalId: "approval:submit",
        actionId: "action:submit",
        actionFingerprint: actionHash,
        tool: "form_submit",
      },
      {
        now,
        approval: approval(awaiting, "approval:submit", "action:submit"),
        approvalActionFingerprint: actionHash,
        approvalActionTool: "form_submit",
      },
    );
    const dispatch = submit.effects.find(
      (effect): effect is Extract<DomainEffect, { type: "DISPATCH_BROWSER_ACTION" }> =>
        effect.type === "DISPATCH_BROWSER_ACTION",
    );
    expect(dispatch).toBeDefined();
    if (!dispatch) {
      throw new Error("Expected a browser dispatch effect.");
    }
    expect(() =>
      claimBrowserDispatch(submit.state, {
        effectId: dispatch.id,
        workerId: "worker:1",
        claimTokenHash,
        consumedApproval: approval(
          submit.state,
          "approval:submit",
          "action:submit",
          "approved",
        ),
        expectedRevision: submit.state.revision,
        claimedAt: now,
      }),
    ).toThrowError(/consumed/i);
    const claim = claimBrowserDispatch(submit.state, {
      effectId: dispatch.id,
      workerId: "worker:1",
      claimTokenHash,
      consumedApproval: approval(
        submit.state,
        "approval:submit",
        "action:submit",
        "consumed",
      ),
      expectedRevision: submit.state.revision,
      claimedAt: now,
    });
    expect(
      canExecuteBrowserAction({
        status: "submitting",
        risk: "consequential",
        tool: "form_submit",
        actionId: "action:submit",
        actionFingerprint: actionHash,
        dispatchEffect: dispatch,
        dispatchDelivery: claim.delivery,
        workerId: "worker:1",
        claimToken,
      }),
    ).toBe(true);
    expect(
      canExecuteBrowserAction({
        status: "submitting",
        risk: "consequential",
        tool: "form_submit",
        actionId: "action:submit",
        actionFingerprint: "d".repeat(64),
        dispatchEffect: dispatch,
        dispatchDelivery: claim.delivery,
        workerId: "worker:1",
        claimToken,
      }),
    ).toBe(false);
    expect(
      canExecuteBrowserAction({
        status: "submitting",
        risk: "consequential",
        tool: "form_submit",
        actionId: "action:submit",
        actionFingerprint: actionHash,
        dispatchEffect: dispatch,
        dispatchDelivery: claim.delivery,
        workerId: "worker:1",
        claimToken: "wrong-token",
      }),
    ).toBe(false);
    expect(
      canExecuteBrowserAction({
        status: "submitting",
        risk: "consequential",
        tool: "form_submit",
        actionId: "action:submit",
        actionFingerprint: actionHash,
        dispatchEffect: dispatch,
        dispatchDelivery: claim.delivery,
        workerId: "worker:other",
        claimToken,
      }),
    ).toBe(false);

    expect(() =>
      claimBrowserDispatch(claim.state, {
        effectId: dispatch.id,
        workerId: "worker:2",
        claimTokenHash: "e".repeat(64),
        consumedApproval: approval(
          claim.state,
          "approval:submit",
          "action:submit",
          "consumed",
        ),
        expectedRevision: claim.state.revision,
        claimedAt: now,
      }),
    ).toThrowError(/already claimed/i);

    const uncertain = recoverStaleBrowserDispatch(claim.state, {
      effectId: dispatch.id,
      expectedRevision: claim.state.revision,
      recoveredAt: now,
    });
    expect(uncertain.delivery.status).toBe("manual_reconciliation");

    const replay = transitionApplication(
      uncertain.state,
      {
        id: "event:submit-gate",
        type: "SUBMIT_APPROVED",
        approvalId: "approval:submit",
        actionId: "action:submit",
        actionFingerprint: actionHash,
        tool: "form_submit",
        expectedRevision: awaiting.revision,
        occurredAt: now,
      },
      { now },
    );
    expect(replay.idempotent).toBe(true);
    expect(replay.effects.some((effect) => effect.type === "DISPATCH_BROWSER_ACTION")).toBe(false);
  });
});
