import { z } from "zod";
import { FormInspectionError, inspectApplicationForm } from "../../../../lib/ats-form-inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Command = z.object({ taskId: z.string().min(1).max(128), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("sec-fetch-site") === "cross-site" || request.headers.get("origin") !== origin) {
    return json({ message: "Open the local dashboard to inspect this form." }, 403);
  }
  const command = Command.safeParse(await request.json().catch(() => null));
  if (!command.success) return json({ message: "Choose an approved application task and its current posting." }, 400);
  try {
    return json(await inspectApplicationForm(command.data.taskId, command.data.fingerprint));
  } catch (error) {
    return json({ message: error instanceof FormInspectionError ? error.message : "Form inspection failed safely." }, error instanceof FormInspectionError ? error.status : 500);
  }
}
