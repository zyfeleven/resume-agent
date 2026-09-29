import { Sha256Schema, type Fact, type FactReviewDecision } from "@resume-agent/contracts";
import { ResumeImportError, detectFactConflicts, factReviewHash, reviewFact } from "@resume-agent/resume-import";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditEvent } from "../../../../../../lib/audit-store";
import { toProfilePayload } from "../../../../../../lib/profile-payload";
import { LOCAL_REVIEWER_ID, updateProfileStore } from "../../../../../../lib/profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The client sends only what it saw. Who decided and when are stamped here, so a review
 * record cannot be backdated or attributed to another reviewer by the request body.
 */
const ReviewBodySchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("verify"), reviewedValueHash: Sha256Schema }).strict(),
  z
    .object({
      decision: z.literal("reject"),
      reviewedValueHash: Sha256Schema,
      reason: z.string().min(1).max(2_000),
    })
    .strict(),
]);

function alreadyDecided(fact: Fact, decision: FactReviewDecision): boolean {
  if (factReviewHash(fact) !== decision.reviewedValueHash) {
    return false;
  }
  if (decision.decision === "verify") {
    return fact.status === "verified" && fact.verification.verifiedBy === decision.verifiedBy;
  }
  return fact.status === "rejected" && fact.rejection.reason === decision.reason;
}

class FactNotFoundError extends Error {
  constructor(factId: string) {
    super(`Fact ${factId} is not in the local profile.`);
    this.name = "FactNotFoundError";
  }
}

export async function POST(request: Request, context: { params: Promise<{ factId: string }> }) {
  const { factId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Send a JSON review decision." }, { status: 400 });
  }

  const parsed = ReviewBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "A decision needs a reviewed value hash, and a rejection needs a reason." },
      { status: 400 },
    );
  }

  const decidedAt = new Date().toISOString();
  const decision =
    parsed.data.decision === "verify"
      ? {
          decision: "verify" as const,
          factId,
          reviewedValueHash: parsed.data.reviewedValueHash,
          verifiedBy: "user" as const,
          decidedAt,
        }
      : {
          decision: "reject" as const,
          factId,
          reviewedValueHash: parsed.data.reviewedValueHash,
          rejectedBy: LOCAL_REVIEWER_ID,
          reason: parsed.data.reason,
          decidedAt,
        };

  try {
    const store = await updateProfileStore((current) => {
      const target = current.facts.find((fact) => fact.id === factId);
      if (!target) {
        throw new FactNotFoundError(factId);
      }
      if (detectFactConflicts(current.facts).some((conflict) => conflict.candidateFactIds.includes(factId))) {
        throw new ResumeImportError(
          "FACT_CONFLICT",
          "This fact conflicts with another source. Resolve the combined evidence review instead.",
        );
      }

      // A repeated click, or a second open tab, must not read as a conflict when the fact
      // already holds exactly the decision being requested against the same value.
      if (alreadyDecided(target, decision)) {
        return current;
      }

      const reviewed = reviewFact(target, decision);
      return {
        ...current,
        facts: current.facts.map((fact) => (fact.id === factId ? reviewed : fact)),
      };
    });

    await recordAuditEvent({
      actorType: "user",
      actorId: LOCAL_REVIEWER_ID,
      eventType: "profile.fact_reviewed",
      payload: { factId, decision: parsed.data.decision },
    });

    return NextResponse.json(toProfilePayload(store));
  } catch (error) {
    if (error instanceof FactNotFoundError) {
      return NextResponse.json({ error: "fact_not_found", message: error.message }, { status: 404 });
    }
    if (error instanceof ResumeImportError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 409 });
    }
    throw error;
  }
}
