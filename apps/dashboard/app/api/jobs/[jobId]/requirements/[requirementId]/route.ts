import { RequirementKindSchema, RequirementPrioritySchema } from "@resume-agent/contracts";
import { JdAnalysisError, applyRequirementReview } from "@resume-agent/jd-analysis";
import { NextResponse } from "next/server";
import { z } from "zod";

import { toJobsPayload } from "../../../../../../lib/job-payload";
import { updateJobStore } from "../../../../../../lib/job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReviewBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_priority"), priority: RequirementPrioritySchema }).strict(),
  z.object({ action: z.literal("set_kind"), kind: RequirementKindSchema }).strict(),
]);

async function review(
  context: { params: Promise<{ jobId: string; requirementId: string }> },
  decisionFor: (requirementId: string) => Record<string, unknown>,
) {
  const { jobId, requirementId } = await context.params;

  try {
    const store = await updateJobStore((current) => {
      const scoped = current.requirements.filter((requirement) => requirement.jobId === jobId);
      const result = applyRequirementReview(scoped, decisionFor(requirementId));
      if (!result.changed) {
        return current;
      }

      return {
        ...current,
        requirements: [
          ...current.requirements.filter((requirement) => requirement.jobId !== jobId),
          ...result.requirements,
        ],
        jobs: current.jobs.map((job) =>
          job.id === jobId ? { ...job, updatedAt: new Date().toISOString() } : job,
        ),
      };
    });

    return NextResponse.json(toJobsPayload(store));
  } catch (error) {
    if (error instanceof JdAnalysisError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 404 });
    }
    throw error;
  }
}

/** Correct the priority or kind the parser assigned to one requirement. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ jobId: string; requirementId: string }> },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Send a JSON review decision." }, { status: 400 });
  }

  const parsed = ReviewBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "A correction sets either a priority or a kind." },
      { status: 400 },
    );
  }

  return review(context, (requirementId) => ({ ...parsed.data, requirementId }));
}

/** Drop a parsed line the reviewer does not consider a requirement. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ jobId: string; requirementId: string }> },
) {
  return review(context, (requirementId) => ({ action: "dismiss", requirementId }));
}
