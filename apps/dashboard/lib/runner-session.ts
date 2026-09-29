import type { BrowserPageSnapshot, Fact } from "@resume-agent/contracts";
import { recordAuditEvent } from "./audit-store";
import { readProfileStore, usableProfileFacts } from "./profile-store";
import {
  BrowserRunner,
  type AnswerSource,
  type FillPlan,
  type SessionRecord,
  type ToolCallRecord,
  type WriteResult,
} from "@resume-agent/browser-runner";
import { geminiConfiguration, type GeminiConfiguration } from "./gemini-form-provider";

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
  if (!holder[RUNNER_KEY]) {
    const runner = new BrowserRunner();
    // Every tool call the policy engine ruled on, allowed or refused, goes to the durable
    // timeline. The runner keeps only a short in-memory window of its own.
    runner.onToolCall = (call) => {
      void recordAuditEvent({
        actorType: "policy_engine",
        actorId: "policy:local",
        eventType: `browser.${call.tool}`,
        payload: {
          tool: call.tool,
          route: call.route,
          reasons: call.reasons,
          outcome: call.outcome,
          ...(call.detail === undefined ? {} : { detail: call.detail }),
        },
      });
    };
    holder[RUNNER_KEY] = runner;
  }
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
  plan?: FillPlan;
  results?: WriteResult[];
  /** Fact values, for the reviewer's own screen. They never travel to the policy engine. */
  answerValues: Record<string, string>;
  intelligence: GeminiConfiguration;
  intelligenceRun?: {
    provider: "gemini";
    model: string;
    mode: "plan" | "fill";
    proposedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    rejected: Array<{ targetId: string; code: string }>;
    responseId?: string;
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * Which verified facts could answer which canonical form fields.
 *
 * A fact answers a field only when its key is exactly that field's canonical name. No
 * splitting, joining, or reformatting: a resume that never stated a first name separately
 * does not gain one here, and that field goes to the person instead.
 */
export function answerSources(facts: readonly Fact[]): AnswerSource[] {
  return facts
    .filter((fact) => fact.status === "verified" && typeof fact.value === "string")
    .map((fact) => ({
      canonicalField: fact.key,
      factId: fact.id,
      factStatus: fact.status,
      sourceCount: fact.sources.length,
      sensitivity: fact.sensitivity,
    }));
}

export function factValues(facts: readonly Fact[]): Map<string, string> {
  return new Map(
    facts
      .filter((fact) => fact.status === "verified" && typeof fact.value === "string")
      .map((fact) => [fact.id, String(fact.value)]),
  );
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
  const profile = await readProfileStore();
  const facts = usableProfileFacts(profile);

  return {
    fixtureOrigin: fixtureOrigin(),
    allowedOrigins: allowedOrigins(),
    fixtureReachable: await isFixtureReachable(),
    session,
    snapshot: session?.lastSnapshot ?? null,
    toolCalls: runner.toolCalls(),
    answerValues: Object.fromEntries(factValues(facts)),
    intelligence: geminiConfiguration(),
  };
}
