import { describe, expect, it } from "vitest";

import {
  TransitionError,
  createResumeMachineState,
  transitionResume,
  type ResumeEvent,
  type ResumeMachineState,
  type ResumeTransitionContext,
} from "../src/index.js";

const now = "2026-07-26T16:00:00-04:00";
const contentHash = "a".repeat(64);
const artifactHash = "b".repeat(64);

type ResumeEventInput<T extends ResumeEvent = ResumeEvent> =
  T extends ResumeEvent ? Omit<T, "expectedRevision" | "occurredAt"> : never;

function apply(
  state: ResumeMachineState,
  event: ResumeEventInput,
  context: ResumeTransitionContext,
) {
  return transitionResume(
    state,
    { ...event, expectedRevision: state.revision, occurredAt: now } as ResumeEvent,
    context,
  ).state;
}

describe("resume state machine", () => {
  it("requires fact checks, user approval, document build, QA, and finalization in order", () => {
    let state = createResumeMachineState("resume:1", contentHash);
    state = apply(state, { id: "event:fact-check", type: "FACT_CHECK_PASSED" }, {
      allClaimsFactBacked: true,
      allFactsVerified: true,
      deterministicClaimChecksPassed: true,
      semanticClaimChecksPassed: true,
    });
    state = apply(state, {
      id: "event:approve",
      type: "USER_APPROVED",
      changeSetId: "changeset:1",
      approvedContentHash: contentHash,
    }, {
      approvalPersisted: true,
      approvalContentHash: contentHash,
      approvalChangeSetId: "changeset:1",
    });
    state = apply(state, {
      id: "event:build",
      type: "DOCX_BUILT",
      artifactId: "artifact:docx",
      artifactHash,
      manifestArtifactId: "artifact:manifest",
      sourceContentHash: contentHash,
    }, { manifestPersisted: true, manifestMatchesInputs: true });
    state = apply(state, {
      id: "event:qa",
      type: "QA_PASSED",
      artifactHash,
      reportArtifactId: "artifact:qa",
    }, {
      structureCheckPassed: true,
      privacyCheckPassed: true,
      renderCheckPassed: true,
      visualCheckPassed: true,
    });
    state = apply(state, { id: "event:final", type: "FINALIZE", artifactHash }, {
      exportPersisted: true,
    });

    expect(state.status).toBe("finalized");
    expect(() => transitionResume(state, {
      id: "event:after-final",
      type: "FINALIZE",
      artifactHash,
      expectedRevision: state.revision,
      occurredAt: now,
    }, { exportPersisted: true })).toThrowError(/immutable/i);
  });

  it("rejects skipped stages and unsupported claims", () => {
    const state = createResumeMachineState("resume:1", contentHash);
    expect(() => transitionResume(state, {
      id: "event:approve",
      type: "USER_APPROVED",
      changeSetId: "changeset:1",
      approvedContentHash: contentHash,
      expectedRevision: 0,
      occurredAt: now,
    }, {
      approvalPersisted: true,
      approvalContentHash: contentHash,
      approvalChangeSetId: "changeset:1",
    })).toThrowError(TransitionError);

    expect(() => transitionResume(state, {
      id: "event:check",
      type: "FACT_CHECK_PASSED",
      expectedRevision: 0,
      occurredAt: now,
    }, {
      allClaimsFactBacked: false,
      allFactsVerified: true,
      deterministicClaimChecksPassed: true,
      semanticClaimChecksPassed: true,
    })).toThrowError(/claim/i);
  });

  it("keeps failed QA in docx_built and rejects artifact mismatches", () => {
    let state = createResumeMachineState("resume:1", contentHash);
    state = apply(state, { id: "event:fact", type: "FACT_CHECK_PASSED" }, {
      allClaimsFactBacked: true,
      allFactsVerified: true,
      deterministicClaimChecksPassed: true,
      semanticClaimChecksPassed: true,
    });
    state = apply(state, {
      id: "event:approve",
      type: "USER_APPROVED",
      changeSetId: "changeset:1",
      approvedContentHash: contentHash,
    }, {
      approvalPersisted: true,
      approvalContentHash: contentHash,
      approvalChangeSetId: "changeset:1",
    });
    state = apply(state, {
      id: "event:build",
      type: "DOCX_BUILT",
      artifactId: "artifact:docx",
      artifactHash,
      manifestArtifactId: "artifact:manifest",
      sourceContentHash: contentHash,
    }, { manifestPersisted: true, manifestMatchesInputs: true });
    state = apply(state, { id: "event:qa-fail", type: "QA_FAILED", reportArtifactId: "artifact:qa" }, {});
    expect(state.status).toBe("docx_built");

    const rebuiltHash = "d".repeat(64);
    state = apply(state, {
      id: "event:rebuild",
      type: "DOCX_BUILT",
      artifactId: "artifact:docx-2",
      artifactHash: rebuiltHash,
      manifestArtifactId: "artifact:manifest-2",
      sourceContentHash: contentHash,
    }, { manifestPersisted: true, manifestMatchesInputs: true });
    expect(state.artifactHash).toBe(rebuiltHash);
    expect(state.qaReportArtifactId).toBeUndefined();

    expect(() => transitionResume(state, {
      id: "event:qa-pass",
      type: "QA_PASSED",
      artifactHash: "c".repeat(64),
      reportArtifactId: "artifact:qa-2",
      expectedRevision: state.revision,
      occurredAt: now,
    }, {
      structureCheckPassed: true,
      privacyCheckPassed: true,
      renderCheckPassed: true,
      visualCheckPassed: true,
    })).toThrowError(/different artifact/i);
  });

  it("re-emits the same durable audit on an idempotent replay and rejects conflicting IDs", () => {
    const initial = createResumeMachineState("resume:1", contentHash);
    const event: ResumeEvent = {
      id: "event:fact",
      type: "FACT_CHECK_PASSED",
      expectedRevision: 0,
      occurredAt: now,
    };
    const context = {
      allClaimsFactBacked: true,
      allFactsVerified: true,
      deterministicClaimChecksPassed: true,
      semanticClaimChecksPassed: true,
    };
    const first = transitionResume(initial, event, context);
    const duplicate = transitionResume(first.state, event, {});

    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.audit).toEqual(first.audit);
    expect(duplicate.audit.id).toBe("event:fact:audit");
    expect(() => transitionResume(first.state, {
      id: "event:fact",
      type: "QA_FAILED",
      reportArtifactId: "artifact:qa",
      expectedRevision: first.state.revision,
      occurredAt: now,
    }, {})).toThrowError(/different content/i);
  });
});
