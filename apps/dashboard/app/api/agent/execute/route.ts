import { z } from "zod";
import { atsExecutionPayload, closeAtsExecution, executeAtsSession, openAtsExecution, prepareAtsAttachment, attachAtsResume } from "../../../../lib/ats-execution";
import { AtsFillPlanError } from "../../../../lib/ats-fill-plan";
import { FormInspectionError } from "../../../../lib/ats-form-inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Id = z.string().min(1).max(128); const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), planId: Id, planHash: Hash }).strict(),
  z.object({ action: z.literal("authorize"), sessionId: Id, challenge: z.string().uuid(), planHash: Hash, confirmOfflineFill: z.literal(true) }).strict(),
  z.object({ action: z.literal("close"), sessionId: Id }).strict(),
  z.object({ action: z.literal("prepare_attachment"), sessionId: Id }).strict(),
  z.object({ action: z.literal("attach_offline"), sessionId: Id, attachmentId: z.string().uuid(), attachmentHash: Hash, confirmOfflineAttachment: z.literal(true) }).strict(),
]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  return error instanceof AtsFillPlanError || error instanceof FormInspectionError ? json({ message: error.message }, error.status)
    : json({ message: "Execution could not finish safely. Inspect the held browser for partial changes; do not retry automatically." }, 500);
}
export async function GET(request: Request) {
  const query = z.object({ planId: Id }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return json({ message: "Choose a reviewed preview." }, 400);
  try { return json(await atsExecutionPayload(query.data.planId)); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const url = new URL(request.url); const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ message: "Use the local dashboard for execution consent." }, 403);
  const parsed = Command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ message: "Choose a supported action and explicit one-time consent. Arbitrary fields and URLs are not accepted." }, 400);
  try {
    const command = parsed.data;
    if (command.action === "close") { await closeAtsExecution(command.sessionId); return json({ closed: true }); }
    if (command.action === "prepare_attachment" || command.action === "attach_offline") {
      const record = command.action === "prepare_attachment" ? await prepareAtsAttachment(command.sessionId)
        : await attachAtsResume(command.sessionId, command.attachmentId, command.attachmentHash, command.confirmOfflineAttachment);
      return json(await atsExecutionPayload(record.planId));
    }
    const record = command.action === "open" ? await openAtsExecution(command.planId, command.planHash)
      : await executeAtsSession(command.sessionId, command.challenge, command.planHash, command.confirmOfflineFill);
    return json(await atsExecutionPayload(record.planId));
  } catch (error) { return failure(error); }
}
