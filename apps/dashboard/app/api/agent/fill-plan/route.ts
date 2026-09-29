import { z } from "zod";
import { AtsFillPlanError, atsFillPayload, buildAtsFillPlan, deleteAtsFillPlan, reviewAtsFillPlan } from "../../../../lib/ats-fill-plan";
import { FormInspectionError } from "../../../../lib/ats-form-inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Id = z.string().min(1).max(128); const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Query = z.object({ taskId: Id, schemaHash: Hash }).strict();
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("build"), taskId: Id, fingerprint: Hash, schemaHash: Hash }).strict(),
  z.object({ action: z.literal("review"), planId: Id, planHash: Hash, decision: z.enum(["approved", "rejected"]) }).strict(),
  z.object({ action: z.literal("delete"), planId: Id, planHash: Hash }).strict(),
]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  return error instanceof AtsFillPlanError || error instanceof FormInspectionError ? json({ message: error.message }, error.status)
    : json({ message: "Plan operation failed safely. No browser field was changed." }, 500);
}
export async function GET(request: Request) {
  const query = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return json({ message: "Choose a task and public form version." }, 400);
  try { return json(await atsFillPayload(query.data.taskId, query.data.schemaHash)); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const url = new URL(request.url); const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ message: "Use the local dashboard to review plans." }, 403);
  const parsed = Command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ message: "Choose a current plan and a supported review action." }, 400);
  try {
    const command = parsed.data;
    if (command.action === "delete") { await deleteAtsFillPlan(command.planId, command.planHash); return json({ deleted: true }); }
    const plan = command.action === "build" ? await buildAtsFillPlan(command.taskId, command.fingerprint, command.schemaHash)
      : await reviewAtsFillPlan(command.planId, command.planHash, command.decision);
    return json(await atsFillPayload(plan.taskId, plan.schemaHash));
  } catch (error) { return failure(error); }
}
