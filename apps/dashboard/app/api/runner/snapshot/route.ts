import { BrowserRunnerError } from "@resume-agent/browser-runner";
import { NextResponse } from "next/server";

import { browserRunner, runnerPayload } from "../../../../lib/runner-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-observe the current page. Refused when the policy engine says the run must stop. */
export async function POST() {
  try {
    await browserRunner().snapshot(new Date().toISOString());
  } catch (error) {
    if (error instanceof BrowserRunnerError) {
      return NextResponse.json({ error: error.code, message: error.message, ...(await runnerPayload()) }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json(await runnerPayload());
}
