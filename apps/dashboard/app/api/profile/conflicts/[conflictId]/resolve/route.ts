import { Sha256Schema } from "@resume-agent/contracts";
import { ResumeImportError, resolveFactConflict } from "@resume-agent/resume-import";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditEvent } from "../../../../../../lib/audit-store";
import { toProfilePayload } from "../../../../../../lib/profile-payload";
import { LOCAL_REVIEWER_ID, updateProfileStore } from "../../../../../../lib/profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ResolveBodySchema = z
  .object({
    selectedFactId: z.string().min(1).max(128),
    reviewedConflictHash: Sha256Schema,
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ conflictId: string }> }) {
  const { conflictId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Send a conflict review decision." }, { status: 400 });
  }

  const parsed = ResolveBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "Choose one candidate from the conflict snapshot you reviewed." },
      { status: 400 },
    );
  }

  try {
    let recordedDecisionId: string | null = null;
    const store = await updateProfileStore((current) => {
      const replay = current.conflictDecisions.find(
        (decision) =>
          decision.conflictId === conflictId &&
          decision.selectedFactId === parsed.data.selectedFactId &&
          decision.reviewedConflictHash === parsed.data.reviewedConflictHash,
      );
      if (replay) {
        recordedDecisionId = replay.id;
        return current;
      }

      const resolved = resolveFactConflict(current.facts, {
        conflictId,
        selectedFactId: parsed.data.selectedFactId,
        reviewedConflictHash: parsed.data.reviewedConflictHash,
        decidedBy: LOCAL_REVIEWER_ID,
        decidedAt: new Date().toISOString(),
      });
      recordedDecisionId = resolved.decision.id;
      return {
        ...current,
        facts: resolved.facts,
        conflictDecisions: [...current.conflictDecisions, resolved.decision],
      };
    });

    await recordAuditEvent({
      actorType: "user",
      actorId: LOCAL_REVIEWER_ID,
      eventType: "profile.fact_conflict_resolved",
      payload: {
        conflictId,
        selectedFactId: parsed.data.selectedFactId,
        reviewedConflictHash: parsed.data.reviewedConflictHash,
        ...(recordedDecisionId ? { decisionId: recordedDecisionId } : {}),
      },
    });

    return NextResponse.json(toProfilePayload(store));
  } catch (error) {
    if (error instanceof ResumeImportError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.code === "CONFLICT_NOT_FOUND" ? 404 : 409 },
      );
    }
    throw error;
  }
}
