import type { BrowserPageSnapshot, PolicyDecision, PolicySafetySignal } from "@resume-agent/contracts";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { BrowserRunnerError } from "./errors.js";
import type { FieldNormalization } from "./field-model.js";
import { planFill, type AnswerSource, type FillPlan } from "./fill-plan.js";
import { requireAutomaticDecision } from "./policy-gate.js";
import { observePage } from "./snapshot.js";
import { WriteReservations, applyFieldWrite, normalizedValueHash, type WriteResult } from "./write.js";

export const RUNNER_VERSION = "browser-runner-v1";

export interface OpenSessionInput {
  applicationId: string;
  runId: string;
  targetUrl: string;
  allowedOrigins: readonly string[];
  headed: boolean;
  now: string;
}

export interface SessionRecord {
  browserSessionRef: string;
  applicationId: string;
  runId: string;
  targetUrl: string;
  allowedOrigins: string[];
  headed: boolean;
  openedAt: string;
  pageGeneration: number;
  lastSnapshot: BrowserPageSnapshot | null;
  safetySignals: PolicySafetySignal[];
}

export interface ToolCallRecord {
  tool: string;
  decidedAt: string;
  route: PolicyDecision["route"];
  reasons: string[];
  outcome: "success" | "refused";
  detail?: string;
}

interface LiveSession extends SessionRecord {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

function originOf(url: string): string {
  return new URL(url).origin;
}

/**
 * Owns the local Playwright process for the dashboard.
 *
 * One session at a time, launched on demand and always closable. Every tool call is
 * evaluated by the policy engine before the browser is touched, and every call — allowed
 * or refused — is recorded so the control plane can show what the runner was permitted to
 * do rather than only what it did.
 */
export class BrowserRunner {
  private session: LiveSession | null = null;
  private readonly calls: ToolCallRecord[] = [];
  private readonly reservations = new WriteReservations();

  get isOpen(): boolean {
    return this.session !== null;
  }

  /** The public view of the current session, without any Playwright handle. */
  describe(): SessionRecord | null {
    if (!this.session) {
      return null;
    }
    const { browser, context, page, ...record } = this.session;
    void browser;
    void context;
    void page;
    return record;
  }

  toolCalls(): ToolCallRecord[] {
    return [...this.calls];
  }

  private record(record: ToolCallRecord): void {
    this.calls.push(record);
    if (this.calls.length > 200) {
      this.calls.shift();
    }
  }

  private runDecision(
    tool: "browser_session_open" | "browser_snapshot",
    input: { targetOrigin: string; currentOrigin?: string; allowedOrigins: readonly string[]; safetySignals: readonly PolicySafetySignal[]; now: string },
  ): PolicyDecision {
    const suffix = `${tool}:${input.now}`;
    try {
      const decision = requireAutomaticDecision({
        tool,
        actionId: `action:${suffix}`,
        decisionId: `policy-decision:${suffix}`,
        evaluatedAt: input.now,
        targetOrigin: input.targetOrigin,
        ...(input.currentOrigin === undefined ? {} : { currentOrigin: input.currentOrigin }),
        allowedOrigins: input.allowedOrigins,
        safetySignals: input.safetySignals,
        automationMode: "standard",
      });
      this.record({
        tool,
        decidedAt: input.now,
        route: decision.route,
        reasons: [...decision.reasons],
        outcome: "success",
      });
      return decision;
    } catch (error) {
      if (error instanceof BrowserRunnerError && error.decision) {
        this.record({
          tool,
          decidedAt: input.now,
          route: error.decision.route,
          reasons: [...error.decision.reasons],
          outcome: "refused",
          detail: error.message,
        });
      }
      throw error;
    }
  }

  /** Launch the browser and observe the first page. */
  async openSession(input: OpenSessionInput): Promise<{ session: SessionRecord; snapshot: BrowserPageSnapshot; decision: PolicyDecision }> {
    if (this.session) {
      await this.closeSession();
    }

    const targetOrigin = originOf(input.targetUrl);
    // The policy engine decides before a browser process exists.
    const decision = this.runDecision("browser_session_open", {
      targetOrigin,
      allowedOrigins: input.allowedOrigins,
      safetySignals: [],
      now: input.now,
    });

    const browser = await chromium.launch({ headless: !input.headed });
    const context = await browser.newContext({ acceptDownloads: false });
    const page = await context.newPage();

    // A page may not reach beyond the origins this run was opened for.
    await context.route("**/*", async (route) => {
      const requestOrigin = originOf(route.request().url());
      if (input.allowedOrigins.includes(requestOrigin)) {
        await route.continue();
        return;
      }
      await route.abort("blockedbyclient");
    });

    try {
      await page.goto(input.targetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    } catch (error) {
      await browser.close();
      throw new BrowserRunnerError(
        "SESSION_CLOSED",
        `The runner could not open ${input.targetUrl}. Is the fixture form running?`,
      );
    }

    const browserSessionRef = `browser-session:${input.runId}:${Date.parse(input.now)}`;
    const observation = await observePage(page, {
      applicationId: input.applicationId,
      runId: input.runId,
      browserSessionRef,
      pageGeneration: 0,
      observedAt: input.now,
    });

    this.session = {
      browser,
      context,
      page,
      browserSessionRef,
      applicationId: input.applicationId,
      runId: input.runId,
      targetUrl: input.targetUrl,
      allowedOrigins: [...input.allowedOrigins],
      headed: input.headed,
      openedAt: input.now,
      pageGeneration: 0,
      lastSnapshot: observation.snapshot,
      safetySignals: observation.safetySignals,
    };

    return { session: this.describe() as SessionRecord, snapshot: observation.snapshot, decision };
  }

  /** Re-observe the current page. */
  async snapshot(now: string): Promise<{ snapshot: BrowserPageSnapshot; decision: PolicyDecision; safetySignals: PolicySafetySignal[]; normalizations: Record<string, FieldNormalization> }> {
    const session = this.session;
    if (!session) {
      throw new BrowserRunnerError("SESSION_NOT_FOUND", "No browser session is open.");
    }

    const currentOrigin = originOf(session.page.url());
    const decision = this.runDecision("browser_snapshot", {
      targetOrigin: currentOrigin,
      currentOrigin,
      allowedOrigins: session.allowedOrigins,
      safetySignals: session.safetySignals,
      now,
    });

    session.pageGeneration += 1;
    const observation = await observePage(session.page, {
      applicationId: session.applicationId,
      runId: session.runId,
      browserSessionRef: session.browserSessionRef,
      pageGeneration: session.pageGeneration,
      observedAt: now,
    });

    session.lastSnapshot = observation.snapshot;
    session.safetySignals = observation.safetySignals;
    return {
      snapshot: observation.snapshot,
      decision,
      safetySignals: observation.safetySignals,
      normalizations: observation.normalizations,
    };
  }

  /** What the runner would fill, and what it would leave to the person, on a fresh page. */
  async planFill(answers: readonly AnswerSource[], now: string): Promise<{ plan: FillPlan; snapshot: BrowserPageSnapshot }> {
    const { snapshot, safetySignals, normalizations } = await this.snapshot(now);
    return {
      plan: planFill({ snapshot, normalizations, answers, safetySignals, evaluatedAt: now }),
      snapshot,
    };
  }

  /**
   * Fill the fields the policy engine allows, and nothing else.
   *
   * The plan is rebuilt against a snapshot taken now, so a page that changed since it was
   * last observed is planned again rather than written blind. Each write takes a
   * single-use reservation bound to that snapshot, and is verified by a digest the page
   * computes — the values themselves are typed into the page and never recorded here.
   */
  async fillFields(input: {
    answers: readonly AnswerSource[];
    valueByFactId: ReadonlyMap<string, string>;
    now: string;
  }): Promise<{ plan: FillPlan; results: WriteResult[] }> {
    const session = this.session;
    if (!session) {
      throw new BrowserRunnerError("SESSION_NOT_FOUND", "No browser session is open.");
    }

    const { plan, snapshot } = await this.planFill(input.answers, input.now);
    const results: WriteResult[] = [];

    for (const field of plan.fields) {
      if (field.route !== "automatic" || !field.factId) {
        continue;
      }

      const value = input.valueByFactId.get(field.factId);
      if (value === undefined || value.length === 0) {
        continue;
      }

      const reservation = this.reservations.issue({
        snapshot,
        targetId: field.targetId,
        expectedValueHash: normalizedValueHash(value),
        issuedAt: input.now,
      });

      try {
        const taken = this.reservations.consume(reservation.reservationId, reservation.nonce, input.now);
        const result = await applyFieldWrite({
          page: session.page,
          snapshot,
          reservation: taken,
          value,
          canonicalField: field.canonicalField,
          now: input.now,
        });

        results.push(result);
        this.record({
          tool: "browser_set_field",
          decidedAt: input.now,
          route: "automatic",
          reasons: [...field.reasons],
          outcome: result.applied ? "success" : "refused",
          ...(result.applied ? {} : { detail: `${field.canonicalField} did not hold the written value.` }),
        });
      } catch (error) {
        this.record({
          tool: "browser_set_field",
          decidedAt: input.now,
          route: "prohibited",
          reasons: [...field.reasons],
          outcome: "refused",
          detail: error instanceof Error ? error.message : "The write failed.",
        });
        throw error;
      }
    }

    // Re-observe so the control plane shows the page as it stands after the writes.
    await this.snapshot(input.now);
    return { plan, results };
  }

  /** Stop the browser. Always available, and safe to call when nothing is open. */
  async closeSession(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) {
      await session.browser.close().catch(() => undefined);
    }
  }
}
