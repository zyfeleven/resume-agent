import { BrowserRunnerError } from "@resume-agent/browser-runner";
import { NextResponse } from "next/server";

import { readProfileStore, usableProfileFacts } from "../../../../lib/profile-store";
import { answerSources, browserRunner, runnerPayload } from "../../../../lib/runner-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Show what the runner would fill, without touching a single field.
 *
 * The plan is built against a snapshot taken now and routed field by field through the
 * policy engine, so the reviewer sees the same decisions the runner would act on.
 */
export async function POST() {
  const runner = browserRunner();
  const profile = await readProfileStore();

  try {
    const { plan } = await runner.planFill(answerSources(usableProfileFacts(profile)), new Date().toISOString());
    return NextResponse.json({ ...(await runnerPayload()), plan });
  } catch (error) {
    if (error instanceof BrowserRunnerError) {
      return NextResponse.json(
        { error: error.code, message: error.message, ...(await runnerPayload()) },
        { status: error.code === "SESSION_NOT_FOUND" ? 409 : 502 },
      );
    }
    throw error;
  }
}
