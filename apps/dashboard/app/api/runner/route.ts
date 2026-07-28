import { BrowserRunnerError } from "@resume-agent/browser-runner";
import { NextResponse } from "next/server";

import { allowedOrigins, browserRunner, fixtureOrigin, runnerPayload } from "../../../lib/runner-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await runnerPayload());
}

/**
 * Start a local browser session against the fixture form.
 *
 * The target and the origin allowlist come from local configuration, never from the
 * request, so the control plane cannot be asked to point the runner at an arbitrary site.
 * The policy engine still evaluates the open before a browser process exists.
 */
export async function POST() {
  const runner = browserRunner();

  try {
    await runner.openSession({
      applicationId: "application:local",
      runId: `run:${Date.now()}`,
      targetUrl: `${fixtureOrigin()}/apply`,
      allowedOrigins: allowedOrigins(),
      headed: false,
      now: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof BrowserRunnerError) {
      return NextResponse.json(
        { error: error.code, message: error.message, ...(await runnerPayload()) },
        { status: error.code === "POLICY_REFUSED" ? 409 : 502 },
      );
    }
    throw error;
  }

  return NextResponse.json(await runnerPayload(), { status: 201 });
}

/** Stop the browser. Always available, even when the runner believes nothing is open. */
export async function DELETE() {
  await browserRunner().closeSession();
  return NextResponse.json(await runnerPayload());
}
