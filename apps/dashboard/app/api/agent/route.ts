import { NextResponse } from "next/server";
import { z } from "zod";
import { AgentError, decideJob, discoverJobs, discoveryPayload, prepareApplication, saveDiscoveryConfig } from "../../../lib/application-agent";
import { DiscoveryConfigSchema } from "../../../lib/discovery-model";
import { readDiscoveryStore } from "../../../lib/discovery-store";
import { AssessmentError, assessJob } from "../../../lib/job-assessment";
import { addDiscoveredSource, searchJobSources, SourceQuerySchema, SourceSearchError } from "../../../lib/job-source-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), config: DiscoveryConfigSchema }).strict(),
  z.object({ action: z.literal("search") }).strict(),
  z.object({ action: z.literal("decide"), id: z.string().max(128), fingerprint: z.string().length(64), decision: z.enum(["new", "saved", "dismissed", "approved"]) }).strict(),
  z.object({ action: z.literal("prepare"), id: z.string().max(128) }).strict(),
  z.object({ action: z.literal("assess"), id: z.string().max(128), fingerprint: z.string().length(64) }).strict(),
  z.object({ action: z.literal("discover_sources"), query: SourceQuerySchema }).strict(),
  z.object({ action: z.literal("add_source"), searchId: z.string().max(128), suggestionId: z.string().max(128), company: z.string().trim().min(1).max(200) }).strict(),
]);
export async function GET() {
  return NextResponse.json(await discoveryPayload(await readDiscoveryStore()), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  // Next can reconstruct request.url with its internal hostname. Compare the browser
  // Origin to the actual Host, never a client-supplied forwarded-host header.
  const requestUrl = new URL(request.url);
  const expectedOrigin = `${requestUrl.protocol}//${request.headers.get("host") ?? requestUrl.host}`;
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expectedOrigin)) {
    return NextResponse.json({ message: "Open the local dashboard to run this action." }, { status: 403 });
  }
  const parsed = Command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Check the search settings and try again." }, { status: 400 });
  try {
    const cmd = parsed.data;
    const store = cmd.action === "configure" ? await saveDiscoveryConfig(cmd.config)
      : cmd.action === "search" ? await discoverJobs()
      : cmd.action === "decide" ? await decideJob(cmd.id, cmd.fingerprint, cmd.decision)
      : cmd.action === "assess" ? await assessJob(cmd.id, cmd.fingerprint)
      : cmd.action === "discover_sources" ? await searchJobSources(cmd.query)
      : cmd.action === "add_source" ? await addDiscoveredSource(cmd.searchId, cmd.suggestionId, cmd.company)
      : await prepareApplication(cmd.id);
    return NextResponse.json(await discoveryPayload(store));
  } catch (error) {
    if (error instanceof SourceSearchError) return NextResponse.json({ message: error.message }, { status: error.status });
    if (error instanceof AssessmentError) return NextResponse.json({ message: error.message }, { status: 422 });
    return NextResponse.json({ message: error instanceof AgentError ? error.message : "The agent could not complete this action. Your saved decisions are retained." }, { status: error instanceof AgentError ? error.status : 500 });
  }
}
