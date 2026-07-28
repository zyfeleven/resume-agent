import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BrowserRunner, BrowserRunnerError, requireAutomaticDecision } from "../src/index.js";

const PORT = 3199;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OTHER_ORIGIN = "http://127.0.0.1:3198";
const NOW = "2026-07-28T09:00:00-04:00";

const fixtureServer = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/fixture-forms/server.mjs",
);

let child: ChildProcess;

async function waitForFixture(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(ORIGIN);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The fixture form did not start.");
}

beforeAll(async () => {
  child = spawn(process.execPath, [fixtureServer], {
    env: { ...process.env, FIXTURE_PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitForFixture();
}, 30_000);

afterAll(async () => {
  child?.kill();
});

describe("policy gate", () => {
  it("refuses an origin the run was not opened for", () => {
    expect(() =>
      requireAutomaticDecision({
        tool: "browser_session_open",
        actionId: "action:1",
        decisionId: "policy-decision:1",
        evaluatedAt: NOW,
        targetOrigin: "https://jobs.example.com",
        allowedOrigins: [ORIGIN],
        safetySignals: [],
        automationMode: "standard",
      }),
    ).toThrow(/origin_not_allowlisted/);
  });

  it("refuses a read while the page declares a synthetic login wall", () => {
    expect(() =>
      requireAutomaticDecision({
        tool: "browser_snapshot",
        actionId: "action:2",
        decisionId: "policy-decision:2",
        evaluatedAt: NOW,
        targetOrigin: ORIGIN,
        currentOrigin: ORIGIN,
        allowedOrigins: [ORIGIN],
        safetySignals: ["login_required"],
        automationMode: "standard",
      }),
    ).toThrow(/login_required/);
  });
});

describe("BrowserRunner", () => {
  it("opens a session, observes the fixture form, and closes", async () => {
    const runner = new BrowserRunner();
    try {
      const { session, snapshot, decision } = await runner.openSession({
        applicationId: "application:test",
        runId: "run:test",
        targetUrl: `${ORIGIN}/apply`,
        allowedOrigins: [ORIGIN],
        headed: false,
        now: new Date().toISOString(),
      });

      expect(decision.route).toBe("automatic");
      expect(session.browserSessionRef).toMatch(/^browser-session:/);
      expect(snapshot.origin).toBe(ORIGIN);
      expect(snapshot.title).toContain("Fixture careers");
      expect(runner.isOpen).toBe(true);

      const names = snapshot.targets.map((target) => target.accessibleName);
      expect(names).toContain("First name");
      expect(names).toContain("Email address");
      expect(snapshot.targets.some((target) => target.kind === "submit")).toBe(true);
      expect(snapshot.targets.find((target) => target.accessibleName === "First name")?.required).toBe(true);
    } finally {
      await runner.closeSession();
    }
  }, 60_000);

  it("never carries a field value out of the page", async () => {
    const runner = new BrowserRunner();
    try {
      const { snapshot } = await runner.openSession({
        applicationId: "application:test",
        runId: "run:test",
        targetUrl: `${ORIGIN}/apply`,
        allowedOrigins: [ORIGIN],
        headed: false,
        now: new Date().toISOString(),
      });

      for (const target of snapshot.targets) {
        expect(target.observedValue.state).toBe("empty");
        expect(target.observedValue.normalizedValueHash).toBeUndefined();
      }
    } finally {
      await runner.closeSession();
    }
  }, 60_000);

  it("marks the page's own sensitive questions as sensitive", async () => {
    const runner = new BrowserRunner();
    try {
      const { snapshot } = await runner.openSession({
        applicationId: "application:test",
        runId: "run:test",
        targetUrl: `${ORIGIN}/apply`,
        allowedOrigins: [ORIGIN],
        headed: false,
        now: new Date().toISOString(),
      });

      const workAuthorization = snapshot.targets.find((target) =>
        target.accessibleName.includes("authorized to work"),
      );
      const email = snapshot.targets.find((target) => target.accessibleName === "Email address");

      expect(workAuthorization?.sensitivity).toBe("sensitive");
      expect(email?.sensitivity).toBe("pii");
    } finally {
      await runner.closeSession();
    }
  }, 60_000);

  it("refuses to open a session for an origin outside the run's allowlist", async () => {
    const runner = new BrowserRunner();
    try {
      await expect(
        runner.openSession({
          applicationId: "application:test",
          runId: "run:test",
          targetUrl: `${ORIGIN}/apply`,
          allowedOrigins: [OTHER_ORIGIN],
          headed: false,
          now: new Date().toISOString(),
        }),
      ).rejects.toThrow(BrowserRunnerError);

      // No browser was launched, and the refusal is on the record.
      expect(runner.isOpen).toBe(false);
      expect(runner.toolCalls().at(-1)).toMatchObject({ outcome: "refused", route: "takeover" });
    } finally {
      await runner.closeSession();
    }
  }, 60_000);

  it("stops observing once the page declares a synthetic safety condition", async () => {
    const runner = new BrowserRunner();
    try {
      await fetch(`${ORIGIN}/__fixture/signal?value=captcha_present`, { method: "POST" });

      // Opening is allowed: the runner cannot know a page's condition until it has seen
      // the page. The snapshot it takes on open records the marker.
      const { snapshot } = await runner.openSession({
        applicationId: "application:test",
        runId: "run:test",
        targetUrl: `${ORIGIN}/apply`,
        allowedOrigins: [ORIGIN],
        headed: false,
        now: new Date().toISOString(),
      });
      expect(snapshot.targets.length).toBeGreaterThan(0);

      // Every call after that is refused while the condition stands.
      await expect(runner.snapshot(new Date().toISOString())).rejects.toThrow(/captcha_present/);
      expect(runner.toolCalls().at(-1)).toMatchObject({ outcome: "refused", route: "takeover" });
    } finally {
      await fetch(`${ORIGIN}/__fixture/reset/f01`, { method: "POST" });
      await runner.closeSession();
    }
  }, 60_000);

  it("records every tool call, allowed or refused", async () => {
    const runner = new BrowserRunner();
    try {
      await runner.openSession({
        applicationId: "application:test",
        runId: "run:test",
        targetUrl: `${ORIGIN}/apply`,
        allowedOrigins: [ORIGIN],
        headed: false,
        now: new Date().toISOString(),
      });
      await runner.snapshot(new Date().toISOString());

      const calls = runner.toolCalls();
      expect(calls.map((call) => call.tool)).toEqual(["browser_session_open", "browser_snapshot"]);
      expect(calls.every((call) => call.route === "automatic" && call.outcome === "success")).toBe(true);
    } finally {
      await runner.closeSession();
    }
  }, 60_000);

  it("reports no session after closing", async () => {
    const runner = new BrowserRunner();
    await runner.openSession({
      applicationId: "application:test",
      runId: "run:test",
      targetUrl: `${ORIGIN}/apply`,
      allowedOrigins: [ORIGIN],
      headed: false,
      now: new Date().toISOString(),
    });
    await runner.closeSession();

    expect(runner.isOpen).toBe(false);
    expect(runner.describe()).toBeNull();
    await expect(runner.snapshot(new Date().toISOString())).rejects.toThrow(/No browser session/);
  }, 60_000);
});
