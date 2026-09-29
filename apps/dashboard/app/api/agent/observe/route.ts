import { z } from "zod";
import { observeApplicationPage, probeApplicationResumeWidget } from "../../../../lib/ats-dom-observation";
import { FormInspectionError } from "../../../../lib/ats-form-inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Binding = z.object({ taskId: z.string().min(1).max(128), fingerprint: Hash, schemaHash: Hash }).strict();
const Command = z.union([Binding, Binding.extend({ action: z.literal('probe_resume_widget'), confirmOfflineSwitch: z.literal(true) }).strict()]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  const url = new URL(request.url); const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ message: "Use the local dashboard for browser observation." }, 403);
  const command = Command.safeParse(await request.json().catch(() => null));
  if (!command.success) return json({ message: "Choose a current posting and inspected public form." }, 400);
  try { return json('action' in command.data
    ? await probeApplicationResumeWidget(command.data.taskId, command.data.fingerprint, command.data.schemaHash, command.data.confirmOfflineSwitch)
    : await observeApplicationPage(command.data.taskId, command.data.fingerprint, command.data.schemaHash)); }
  catch (error) { return json({ message: error instanceof FormInspectionError ? error.message : "Observation failed safely." }, error instanceof FormInspectionError ? error.status : 500); }
}
