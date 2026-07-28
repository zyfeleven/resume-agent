import type { BrowserPageSnapshot } from "@resume-agent/contracts";
import { BrowserRunner, type SessionRecord, type ToolCallRecord } from "@resume-agent/browser-runner";

/**
 * The dashboard owns one local browser runner.
 *
 * It is held on `globalThis` so a dev-server module reload does not orphan a running
 * Chromium process, and it is deliberately a single session: this control plane
 * supervises one run at a time, and a run nobody is watching should not exist.
 */
const RUNNER_KEY = Symbol.for("resume-agent.browser-runner");

interface RunnerGlobal {
  [RUNNER_KEY]?: BrowserRunner;
}

export function browserRunner(): BrowserRunner {
  const holder = globalThis as RunnerGlobal;
  holder[RUNNER_KEY] ??= new BrowserRunner();
  return holder[RUNNER_KEY];
}

export function fixtureOrigin(): string {
  return process.env.RESUME_AGENT_FIXTURE_ORIGIN ?? "http://127.0.0.1:3100";
}

/** The only origins this run may touch. Anything else is the policy engine's decision. */
export function allowedOrigins(): string[] {
  return [fixtureOrigin()];
}

export interface RunnerPayload {
  fixtureOrigin: string;
  allowedOrigins: string[];
  fixtureReachable: boolean;
  session: SessionRecord | null;
  snapshot: BrowserPageSnapshot | null;
  toolCalls: ToolCallRecord[];
}

async function isFixtureReachable(): Promise<boolean> {
  try {
    const response = await fetch(fixtureOrigin(), { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function runnerPayload(): Promise<RunnerPayload> {
  const runner = browserRunner();
  const session = runner.describe();

  return {
    fixtureOrigin: fixtureOrigin(),
    allowedOrigins: allowedOrigins(),
    fixtureReachable: await isFixtureReachable(),
    session,
    snapshot: session?.lastSnapshot ?? null,
    toolCalls: runner.toolCalls(),
  };
}
