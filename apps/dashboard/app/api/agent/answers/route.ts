import { z } from "zod";
import { AtsAnswerError, atsAnswerPayload, generateAtsAnswerPlan, reviewAtsAnswer } from "../../../../lib/ats-answer-plan";
import { FormInspectionError } from "../../../../lib/ats-form-inspection";
import { updateAtsAnswerStore } from "../../../../lib/ats-answer-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Id = z.string().min(1).max(128);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Query = z.object({ taskId: Id, schemaHash: Hash }).strict();
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), taskId: Id, fingerprint: Hash, schemaHash: Hash }).strict(),
  z.object({ action: z.literal("review"), planId: Id, planHash: Hash, questionId: Id, decision: z.enum(["approved", "rejected"]) }).strict(),
  z.object({ action: z.literal("delete"), planId: Id, planHash: Hash }).strict(),
]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  return error instanceof AtsAnswerError || error instanceof FormInspectionError
    ? json({ message: error.message }, error.status) : json({ message: "Answer preparation failed safely. No ATS action was taken." }, 500);
}
export async function GET(request: Request) {
  const query = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return json({ message: "Choose a task and inspected form version." }, 400);
  try { return json(await atsAnswerPayload(query.data.taskId, query.data.schemaHash)); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const url = new URL(request.url); const expected = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site") return json({ message: "Use the local dashboard to manage answer drafts." }, 403);
  const parsed = Command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ message: "Choose a current answer plan and review decision." }, 400);
  try {
    const command = parsed.data;
    if (command.action === "delete") {
      await updateAtsAnswerStore((store) => {
        const plan = store.plans.find((p) => p.id === command.planId);
        if (!plan || plan.planHash !== command.planHash) throw new AtsAnswerError("The plan changed. Reload before deleting.");
        return { ...store, plans: store.plans.filter((p) => p.id !== command.planId) };
      });
      return json({ deleted: true });
    }
    const plan = command.action === "generate"
      ? await generateAtsAnswerPlan(command.taskId, command.fingerprint, command.schemaHash)
      : await reviewAtsAnswer(command.planId, command.planHash, command.questionId, command.decision);
    return json(await atsAnswerPayload(plan.taskId, plan.schemaHash));
  } catch (error) { return failure(error); }
}
