import {
  FactReviewDecisionSchema,
  FactSchema,
  type Fact,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import { ResumeImportError } from "./errors.js";

/**
 * Digest of the identity and value a reviewer saw on screen. A decision carries this
 * hash so a fact whose value changed between rendering and submission fails closed
 * instead of inheriting an approval it never received.
 */
export function factReviewHash(factInput: unknown): string {
  const fact = FactSchema.parse(factInput);
  const encoded = JSON.stringify([fact.id, fact.profileId, fact.kind, fact.key, fact.value]);
  return createHash("sha256").update(encoded).digest("hex");
}

/**
 * Apply one reviewer decision to one extracted fact.
 *
 * Only a `pending` fact can be decided. Replaying the identical decision is idempotent,
 * so a retried request cannot bump the version or rewrite the decision timestamp; any
 * other second decision is rejected and must be resolved by the caller.
 */
export function reviewFact(factInput: unknown, decisionInput: unknown): Fact {
  const fact = FactSchema.parse(factInput);
  const decision = FactReviewDecisionSchema.parse(decisionInput);

  if (decision.factId !== fact.id) {
    throw new ResumeImportError("FACT_MISMATCH", `Decision ${decision.factId} does not target fact ${fact.id}.`);
  }
  if (decision.reviewedValueHash !== factReviewHash(fact)) {
    throw new ResumeImportError("STALE_REVIEW", "The reviewed value no longer matches this fact.");
  }

  if (fact.status === "verified") {
    if (
      decision.decision === "verify" &&
      fact.verification.verifiedBy === decision.verifiedBy &&
      fact.verification.verifiedAt === decision.decidedAt
    ) {
      return fact;
    }
    throw new ResumeImportError("ALREADY_REVIEWED", `Fact ${fact.id} is already verified.`);
  }

  if (fact.status === "rejected") {
    if (
      decision.decision === "reject" &&
      fact.rejection.rejectedBy === decision.rejectedBy &&
      fact.rejection.rejectedAt === decision.decidedAt &&
      fact.rejection.reason === decision.reason
    ) {
      return fact;
    }
    throw new ResumeImportError("ALREADY_REVIEWED", `Fact ${fact.id} is already rejected.`);
  }

  if (Date.parse(decision.decidedAt) < Date.parse(fact.updatedAt)) {
    throw new ResumeImportError("REVIEW_TIME_REGRESSION", "Decision time cannot move backwards.");
  }

  const base = { ...fact, version: fact.version + 1, updatedAt: decision.decidedAt };

  if (decision.decision === "verify") {
    return FactSchema.parse({
      ...base,
      status: "verified",
      verification: { verifiedBy: decision.verifiedBy, verifiedAt: decision.decidedAt },
    });
  }

  return FactSchema.parse({
    ...base,
    status: "rejected",
    rejection: {
      rejectedBy: decision.rejectedBy,
      rejectedAt: decision.decidedAt,
      reason: decision.reason,
    },
  });
}

export interface FactReviewSummary {
  pending: number;
  verified: number;
  rejected: number;
}

export function summarizeFactReview(facts: readonly Fact[]): FactReviewSummary {
  const summary: FactReviewSummary = { pending: 0, verified: 0, rejected: 0 };
  for (const fact of facts) {
    summary[fact.status] += 1;
  }
  return summary;
}
