import type { ApplicationCheckpoint } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import { planActionReplay, planCheckpointRecovery } from "../src/index.js";

const now = "2026-07-26T16:00:00-04:00";
const fingerprint = "a".repeat(64);

function checkpoint(overrides: Partial<ApplicationCheckpoint> = {}): ApplicationCheckpoint {
  return {
    id: "checkpoint:1",
    applicationId: "application:1",
    runId: "run:1",
    sequence: 4,
    stateRevision: 9,
    status: "running",
    browserSessionRef: "browser-session:1",
    allowedOrigin: "https://jobs.example.com",
    url: "https://jobs.example.com/apply",
    pageFingerprint: fingerprint,
    completedActionIds: [],
    fieldDecisionIds: [],
    artifactIds: [],
    lastAuditEventHash: "b".repeat(64),
    createdAt: now,
    ...overrides,
  };
}

const scope = {
  applicationId: "application:1",
  runId: "run:1",
  latestCommittedSequence: 4,
  expectedCheckpointStateRevision: 9,
  browserSessionRef: "browser-session:1",
  checkpointCommitted: true as const,
  sessionValid: true,
};

describe("checkpoint recovery", () => {
  it("resumes only an exact committed checkpoint from the current application run", () => {
    const current = checkpoint();
    expect(
      planCheckpointRecovery(
        current,
        { origin: "https://jobs.example.com", pageFingerprint: fingerprint },
        scope,
      ),
    ).toBe("resume");

    for (const stale of [
      checkpoint({ applicationId: "application:other" }),
      checkpoint({ runId: "run:other" }),
      checkpoint({ sequence: 3 }),
      checkpoint({ stateRevision: 8 }),
      checkpoint({ browserSessionRef: "browser-session:other" }),
    ]) {
      expect(
        planCheckpointRecovery(
          stale,
          { origin: "https://jobs.example.com", pageFingerprint: fingerprint },
          scope,
        ),
      ).toBe("reject_checkpoint");
    }
  });

  it("re-observes changed pages and stops on changed or malformed origins", () => {
    expect(
      planCheckpointRecovery(
        checkpoint(),
        { origin: "https://jobs.example.com", pageFingerprint: "c".repeat(64) },
        scope,
      ),
    ).toBe("rebuild_observations");
    expect(
      planCheckpointRecovery(
        checkpoint(),
        { origin: "https://evil.example", pageFingerprint: fingerprint },
        scope,
      ),
    ).toBe("takeover");
    expect(
      planCheckpointRecovery(
        checkpoint(),
        { origin: "not a URL", pageFingerprint: fingerprint },
        scope,
      ),
    ).toBe("takeover");
  });

  it("never resumes submission, terminal, wait, or invalid session states", () => {
    const observation = { origin: "https://jobs.example.com", pageFingerprint: fingerprint };
    expect(planCheckpointRecovery(checkpoint({ status: "submitting" }), observation, scope)).toBe(
      "manual_submission_reconciliation",
    );
    for (const status of ["completed", "failed_final", "cancelled"] as const) {
      expect(planCheckpointRecovery(checkpoint({ status }), observation, scope)).toBe("terminal_noop");
    }
    for (const status of [
      "paused",
      "needs_input",
      "needs_approval",
      "user_takeover",
      "review",
      "awaiting_submit_approval",
    ] as const) {
      expect(planCheckpointRecovery(checkpoint({ status }), observation, scope)).toBe("wait_for_user");
    }
    expect(
      planCheckpointRecovery(checkpoint(), observation, { ...scope, sessionValid: false }),
    ).toBe("takeover");
  });

  it("never replays takeover or consequential actions", () => {
    for (const risk of ["takeover", "consequential"] as const) {
      expect(
        planActionReplay({
          actionId: "action:sensitive",
          risk,
          completedActionIds: [],
          postconditionObserved: false,
          outcomeKnown: false,
        }),
      ).toBe("manual_reconciliation");
    }
  });

  it("skips an observed postcondition even when the crash preceded checkpoint persistence", () => {
    expect(
      planActionReplay({
        actionId: "action:fill",
        risk: "reversible",
        completedActionIds: [],
        postconditionObserved: true,
        outcomeKnown: true,
      }),
    ).toBe("skip");
    expect(
      planActionReplay({
        actionId: "action:fill",
        risk: "reversible",
        completedActionIds: [],
        postconditionObserved: false,
        outcomeKnown: false,
      }),
    ).toBe("verify");
  });
});
