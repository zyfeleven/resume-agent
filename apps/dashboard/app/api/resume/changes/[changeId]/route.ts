import { Sha256Schema } from "@resume-agent/contracts";
import { ResumeTailorError, reviewChange } from "@resume-agent/resume-tailor";
import { NextResponse } from "next/server";
import { z } from "zod";

import { LOCAL_REVIEWER_ID } from "../../../../../lib/profile-store";
import { buildResumePayload } from "../../../../../lib/resume-view";
import { updateResumeStore } from "../../../../../lib/resume-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The client sends what it saw. Who decided and when are stamped here. */
const ReviewBodySchema = z
  .object({
    changeSetId: z.string().min(1).max(128),
    decision: z.enum(["approved", "rejected"]),
    reviewedChangeHash: Sha256Schema,
  })
  .strict();

class ChangeSetNotFoundError extends Error {}

export async function POST(request: Request, context: { params: Promise<{ changeId: string }> }) {
  const { changeId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Send a JSON review decision." }, { status: 400 });
  }

  const parsed = ReviewBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "A decision needs a change set, an outcome, and the reviewed change hash." },
      { status: 400 },
    );
  }

  const decidedAt = new Date().toISOString();

  try {
    const store = await updateResumeStore((current) => {
      const changeSet = current.changeSets.find((entry) => entry.id === parsed.data.changeSetId);
      if (!changeSet) {
        throw new ChangeSetNotFoundError("That change set is not stored locally.");
      }

      const review = reviewChange(changeSet, {
        changeId,
        decision: parsed.data.decision,
        reviewedChangeHash: parsed.data.reviewedChangeHash,
        decidedBy: LOCAL_REVIEWER_ID,
        decidedAt,
      });

      return {
        ...current,
        reviews: [
          ...current.reviews.filter(
            (entry) => !(entry.changeSetId === review.changeSetId && entry.changeId === review.changeId),
          ),
          review,
        ],
      };
    });

    return NextResponse.json(await buildResumePayload(store, parsed.data.changeSetId));
  } catch (error) {
    if (error instanceof ChangeSetNotFoundError) {
      return NextResponse.json({ error: "change_set_not_found", message: error.message }, { status: 404 });
    }
    if (error instanceof ResumeTailorError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.code === "CHANGE_NOT_FOUND" ? 404 : 409 });
    }
    throw error;
  }
}
