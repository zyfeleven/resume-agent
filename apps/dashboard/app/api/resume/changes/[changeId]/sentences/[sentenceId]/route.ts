import { Sha256Schema } from "@resume-agent/contracts";
import { ResumeTailorError, reviewSentenceChange } from "@resume-agent/resume-tailor";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditEvent } from "../../../../../../../lib/audit-store";
import { LOCAL_REVIEWER_ID } from "../../../../../../../lib/profile-store";
import { buildResumePayload } from "../../../../../../../lib/resume-view";
import { updateResumeStore } from "../../../../../../../lib/resume-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReviewBodySchema = z
  .object({
    changeSetId: z.string().min(1).max(128),
    decision: z.enum(["approved", "rejected"]),
    reviewedSentenceHash: Sha256Schema,
  })
  .strict();

class ChangeSetNotFoundError extends Error {}

export async function POST(
  request: Request,
  context: { params: Promise<{ changeId: string; sentenceId: string }> },
) {
  const { changeId, sentenceId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Send a sentence review decision." }, { status: 400 });
  }

  const parsed = ReviewBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "A decision needs a change set, outcome, and reviewed sentence hash." },
      { status: 400 },
    );
  }

  try {
    const store = await updateResumeStore((current) => {
      const changeSet = current.changeSets.find((entry) => entry.id === parsed.data.changeSetId);
      if (!changeSet) throw new ChangeSetNotFoundError("That change set is not stored locally.");
      const review = reviewSentenceChange(changeSet, {
        changeId,
        sentenceId,
        decision: parsed.data.decision,
        reviewedSentenceHash: parsed.data.reviewedSentenceHash,
        decidedBy: LOCAL_REVIEWER_ID,
        decidedAt: new Date().toISOString(),
      });

      return {
        ...current,
        sentenceReviews: [
          ...current.sentenceReviews.filter(
            (entry) => !(entry.changeSetId === review.changeSetId && entry.sentenceId === review.sentenceId),
          ),
          review,
        ],
      };
    });

    await recordAuditEvent({
      actorType: "user",
      actorId: LOCAL_REVIEWER_ID,
      eventType: "resume.sentence_reviewed",
      payload: { changeSetId: parsed.data.changeSetId, changeId, sentenceId, decision: parsed.data.decision },
    });
    return NextResponse.json(await buildResumePayload(store, parsed.data.changeSetId));
  } catch (error) {
    if (error instanceof ChangeSetNotFoundError) {
      return NextResponse.json({ error: "change_set_not_found", message: error.message }, { status: 404 });
    }
    if (error instanceof ResumeTailorError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.code === "CHANGE_NOT_FOUND" ? 404 : 409 },
      );
    }
    throw error;
  }
}
