import { BrowserRunnerError } from "@resume-agent/browser-runner";
import { NextResponse } from "next/server";

import { readProfileStore, usableProfileFacts } from "../../../../lib/profile-store";
import { answerSources, browserRunner, factValues, runnerPayload } from "../../../../lib/runner-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fill the fields the policy engine allows on the open page.
 *
 * The request carries no values and no field list: what may be filled is decided from the
 * verified facts this dashboard holds and the page as it stands right now, so the control
 * plane cannot be asked to type something a person never verified.
 */
export async function POST() {
  const runner = browserRunner();
  const profile = await readProfileStore();
  const facts = usableProfileFacts(profile);

  try {
    const { plan, results } = await runner.fillFields({
      answers: answerSources(facts),
      valueByFactId: factValues(facts),
      now: new Date().toISOString(),
    });

    return NextResponse.json({
      ...(await runnerPayload()),
      plan,
      results,
    });
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
