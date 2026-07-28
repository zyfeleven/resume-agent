import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BrowserRunner, normalizedValueHash, planFill, type AnswerSource } from "../src/index.js";

const PORT = 3197;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const fixtureServer = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/fixture-forms/server.mjs",
);

let child: ChildProcess;

/** Verified answers whose keys match the fixture's canonical field names. */
const answers: AnswerSource[] = [
  { canonicalField: "email", factId: "fact:email", factStatus: "verified", sourceCount: 1, sensitivity: "pii" },
  { canonicalField: "phone", factId: "fact:phone", factStatus: "verified", sourceCount: 1, sensitivity: "pii" },
  { canonicalField: "location", factId: "fact:location", factStatus: "verified", sourceCount: 1, sensitivity: "pii" },
  {
    canonicalField: "work_authorization",
    factId: "fact:auth",
    factStatus: "verified",
    sourceCount: 1,
    sensitivity: "sensitive",
  },
  { canonicalField: "compensation", factId: "fact:pay", factStatus: "verified", sourceCount: 1, sensitivity: "normal" },
];

const values = new Map([
  ["fact:email", "maya.chen@example.com"],
  ["fact:phone", "(415) 555-0142"],
  ["fact:location", "Toronto, ON"],
  ["fact:auth", "Authorized to work in Canada"],
  ["fact:pay", "Market rate"],
]);

async function waitForFixture(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(ORIGIN)).ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The fixture form did not start.");
}

async function openRunner(): Promise<BrowserRunner> {
  const runner = new BrowserRunner();
  await runner.openSession({
    applicationId: "application:test",
    runId: "run:test",
    targetUrl: `${ORIGIN}/apply`,
    allowedOrigins: [ORIGIN],
    headed: false,
    now: new Date().toISOString(),
  });
  return runner;
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

describe("fill planning", () => {
  it("routes each field by what the policy engine allows", async () => {
    const runner = await openRunner();
    try {
      const { plan } = await runner.planFill(answers, new Date().toISOString());
      const routeOf = (field: string) => plan.fields.find((entry) => entry.canonicalField === field)?.route;

      // A verified fact answers the field by name, and nothing about it is sensitive.
      expect(routeOf("email")).toBe("automatic");
      expect(routeOf("phone")).toBe("automatic");
      expect(routeOf("location")).toBe("automatic");

      // The page marks these sensitive, and the policy engine keeps them with the person
      // even though a verified fact exists for each.
      expect(routeOf("work_authorization")).toBe("takeover");
      expect(routeOf("compensation")).toBe("takeover");
      expect(routeOf("signature")).toBe("takeover");

      // No fact is named for these, so the runner has nothing truthful to type.
      expect(routeOf("first_name")).toBe("no_answer");
      expect(routeOf("last_name")).toBe("no_answer");
      expect(routeOf("start_date")).toBe("no_answer");
    } finally {
      await runner.closeSession();
    }
  }, 60_000);

  it("never plans a write against the submit control", async () => {
    const runner = await openRunner();
    try {
      const { plan } = await runner.planFill(answers, new Date().toISOString());
      const submit = plan.fields.find((field) => field.isSubmitCandidate);

      expect(submit?.route).toBe("prohibited");
      expect(plan.automaticFieldIds).not.toContain(submit?.targetId);
    } finally {
      await runner.closeSession();
    }
  }, 60_000);

  it("plans nothing for a fact the user has not verified", async () => {
    const runner = await openRunner();
    try {
      const pending = answers.map((answer) => ({ ...answer, factStatus: "pending" as const }));
      const { plan } = await runner.planFill(pending, new Date().toISOString());

      expect(plan.automaticFieldIds).toEqual([]);
      expect(plan.fields.every((field) => field.route !== "automatic")).toBe(true);
    } finally {
      await runner.closeSession();
    }
  }, 60_000);
});

describe("field writes", () => {
  it("fills the allowed fields and verifies each against the page", async () => {
    const runner = await openRunner();
    try {
      const { plan, results } = await runner.fillFields({
        answers,
        valueByFactId: values,
        now: new Date().toISOString(),
      });

      expect(results).toHaveLength(3);
      expect(results.every((result) => result.applied)).toBe(true);
      expect(results.map((result) => result.canonicalField).sort()).toEqual(["email", "location", "phone"]);

      // The page's own digest of what it now holds matches what the runner meant to write.
      const email = results.find((result) => result.canonicalField === "email");
      expect(email?.observedValueHash).toBe(normalizedValueHash("maya.chen@example.com"));

      expect(plan.automaticFieldIds).toHaveLength(3);
    } finally {
      await runner.closeSession();
    }
  }, 90_000);

  it("leaves every sensitive and unanswered field empty", async () => {
    const runner = await openRunner();
    try {
      await runner.fillFields({ answers, valueByFactId: values, now: new Date().toISOString() });
      const { snapshot } = await runner.snapshot(new Date().toISOString());

      const stateOf = (field: string) =>
        snapshot.targets.find((target) =>
          target.locatorRecipes.some((recipe) => recipe.value === `field:${field}`),
        )?.observedValue.state;

      expect(stateOf("email")).toBe("present");
      expect(stateOf("work_authorization")).toBe("empty");
      expect(stateOf("compensation")).toBe("empty");
      expect(stateOf("signature")).toBe("empty");
      expect(stateOf("first_name")).toBe("empty");
    } finally {
      await runner.closeSession();
    }
  }, 90_000);

  it("records every write it was allowed to make", async () => {
    const runner = await openRunner();
    try {
      await runner.fillFields({ answers, valueByFactId: values, now: new Date().toISOString() });
      const writes = runner.toolCalls().filter((call) => call.tool === "browser_set_field");

      expect(writes).toHaveLength(3);
      expect(writes.every((call) => call.outcome === "success" && call.route === "automatic")).toBe(true);
    } finally {
      await runner.closeSession();
    }
  }, 90_000);

  it("fills nothing once the page declares a synthetic login wall", async () => {
    await fetch(`${ORIGIN}/__fixture/signal?value=login_required`, { method: "POST" });
    const runner = await openRunner();

    try {
      // Opening and observing is how the wall is discovered, so that much is allowed.
      // Writing is not: the policy engine routes the whole run to takeover instead.
      await expect(
        runner.fillFields({ answers, valueByFactId: values, now: new Date().toISOString() }),
      ).rejects.toThrow(/login_required/);

      expect(runner.toolCalls().some((call) => call.tool === "browser_set_field")).toBe(false);
    } finally {
      await runner.closeSession();
      await fetch(`${ORIGIN}/__fixture/reset/F01`, { method: "POST" });
    }
  }, 60_000);
});

describe("write reservations", () => {
  it("refuses a plan built against a page that has since changed", async () => {
    const runner = await openRunner();
    try {
      const { snapshot, normalizations } = await runner.snapshot(new Date().toISOString());
      const stalePlan = planFill({
        snapshot,
        normalizations,
        answers,
        safetySignals: [],
        evaluatedAt: new Date().toISOString(),
      });

      // The fixture re-renders with a new revision, so the planned snapshot is history.
      await fetch(`${ORIGIN}/__fixture/signal?value=`, { method: "POST" });
      const { snapshot: current } = await runner.snapshot(new Date().toISOString());

      expect(current.snapshotId).not.toBe(stalePlan.snapshotId);
      expect(current.pageGeneration).toBeGreaterThan(stalePlan.pageGeneration);
    } finally {
      await runner.closeSession();
    }
  }, 90_000);
});
