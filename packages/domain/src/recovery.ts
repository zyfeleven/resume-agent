import {
  ApplicationCheckpointSchema,
  EntityIdSchema,
  Sha256Schema,
  type ApplicationCheckpoint,
} from "@resume-agent/contracts";
import { z } from "zod";

import type { ActionRisk } from "./application-machine.js";

export const RecoveryScopeSchema = z
  .object({
    applicationId: EntityIdSchema,
    runId: EntityIdSchema,
    latestCommittedSequence: z.number().int().nonnegative(),
    expectedCheckpointStateRevision: z.number().int().nonnegative(),
    browserSessionRef: EntityIdSchema,
    checkpointCommitted: z.literal(true),
    sessionValid: z.boolean(),
  })
  .strict();

export interface RecoveryObservation {
  origin: string;
  pageFingerprint: string;
}

export type RecoveryPlan =
  | "manual_submission_reconciliation"
  | "rebuild_observations"
  | "reject_checkpoint"
  | "resume"
  | "takeover"
  | "terminal_noop"
  | "wait_for_user";

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function planCheckpointRecovery(
  checkpointInput: ApplicationCheckpoint,
  observationInput: RecoveryObservation,
  scopeInput: z.input<typeof RecoveryScopeSchema>,
): RecoveryPlan {
  const checkpointResult = ApplicationCheckpointSchema.safeParse(checkpointInput);
  const observationResult = z
    .object({
      origin: z.string().min(1).max(2_048),
      pageFingerprint: Sha256Schema,
    })
    .strict()
    .safeParse(observationInput);
  const scopeResult = RecoveryScopeSchema.safeParse(scopeInput);

  if (!checkpointResult.success || !observationResult.success || !scopeResult.success) {
    return "reject_checkpoint";
  }
  const checkpoint = checkpointResult.data;
  const observation = observationResult.data;
  const scope = scopeResult.data;

  if (
    checkpoint.applicationId !== scope.applicationId ||
    checkpoint.runId !== scope.runId ||
    checkpoint.sequence !== scope.latestCommittedSequence ||
    checkpoint.stateRevision !== scope.expectedCheckpointStateRevision ||
    checkpoint.browserSessionRef !== scope.browserSessionRef
  ) {
    return "reject_checkpoint";
  }
  if (checkpoint.status === "submitting") {
    return "manual_submission_reconciliation";
  }
  if (["completed", "failed_final", "cancelled"].includes(checkpoint.status)) {
    return "terminal_noop";
  }
  if (!scope.sessionValid) {
    return "takeover";
  }

  const allowedOrigin = normalizeOrigin(checkpoint.allowedOrigin);
  const observedOrigin = normalizeOrigin(observation.origin);
  if (!allowedOrigin || !observedOrigin || allowedOrigin !== observedOrigin) {
    return "takeover";
  }
  if (
    ["paused", "needs_input", "needs_approval", "user_takeover", "review", "awaiting_submit_approval"]
      .includes(checkpoint.status)
  ) {
    return "wait_for_user";
  }
  if (!["running", "failed_recoverable"].includes(checkpoint.status)) {
    return "reject_checkpoint";
  }
  if (checkpoint.pageFingerprint !== observation.pageFingerprint) {
    return "rebuild_observations";
  }
  return "resume";
}

export interface ReplayInput {
  actionId: string;
  risk: ActionRisk;
  completedActionIds: string[];
  postconditionObserved: boolean;
  outcomeKnown: boolean;
}

export type ReplayPlan = "manual_reconciliation" | "retry" | "skip" | "verify";

export function planActionReplay(input: ReplayInput): ReplayPlan {
  if (input.risk === "takeover" || input.risk === "consequential") {
    return "manual_reconciliation";
  }
  if (input.postconditionObserved) {
    return "skip";
  }
  if (!input.outcomeKnown) {
    return "verify";
  }
  return "retry";
}
