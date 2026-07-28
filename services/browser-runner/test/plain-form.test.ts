import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BrowserRunner, type AnswerSource } from "../src/index.js";

const PORT = 3195;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const fixtureServer = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/fixture-forms/server.mjs",
);

let child: ChildProcess;

const answers: AnswerSource[] = [
  { canonicalField: "email", factId: "fact:email", factStatus: "verified", sourceCount: 1, sensitivity: "pii" },
  { canonicalField: "phone", factId: "fact:phone", factStatus: "verified", sourceCount: 1, sensitivity: "pii" },
  { canonicalField: "city", factId: "fact:city", factStatus: "verified", sourceCount: 1, sensitivity: "pii" },
  { canonicalField: "linkedin", factId: "fact:li", factStatus: "verified", sourceCount: 1, sensitivity: "pii" },
  { canonicalField: "compensation", factId: "fact:pay", factStatus: "verified", sourceCount: 1, sensitivity: "normal" },
  { canonicalField: "gender", factId: "fact:gender", factStatus: "verified", sourceCount: 1, sensitivity: "normal" },
];

const values = new Map([
  ["fact:email", "maya.chen@example.com"],
  ["fact:phone", "(415) 555-0142"],
  ["fact:city", "Toronto"],
  ["fact:li", "https://linkedin.com/in/mayachen"],
  ["fact:pay", "Market rate"],
  ["fact:gender", "Prefer not to say"],
]);

async function waitForFixture(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(ORIGIN)).ok) {
        return;
      }
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The fixture form did not start.");
}

async function openPlainForm(): Promise<BrowserRunner> {
  const runner = new BrowserRunner();
  await runner.openSession({
    applicationId: "application:test",
    runId: "run:plain",
    targetUrl: `${ORIGIN}/apply/plain`,
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

/**
 * The plain form carries no test IDs, no sensitivity markers, and no submit marker — it is
 * shaped like a real applicant tracking system. Everything here has to come from meaning.
 */
describe("a form with no fixture conventions", () => {
  it("recognizes fields from labels, autocomplete tokens, and control names", async () => {
    const runner = await openPlainForm();
    try {
      const { plan } = await runner.planFill(answers, new Date().toISOString());
      const named = plan.fields.map((field) => field.canonicalField);

      expect(named).toContain("first_name");
      expect(named).toContain("last_name");
      expect(named).toContain("email");
      expect(named).toContain("phone");
      expect(named).toContain("city");
      expect(named).toContain("start_date");
      expect(named).toContain("referral_source");
    } finally {
      await runner.closeSession();
    }
  }, 60_000);

  it("classifies EEO and legal questions as sensitive with nothing marking them", async () => {
    const runner = await openPlainForm();
    try {
      const { plan } = await runner.planFill(answers, new Date().toISOString());
      const routeOf = (field: string) => plan.fields.find((entry) => entry.canonicalField === field)?.route;

      for (const field of ["work_authorization", "visa_sponsorship", "compensation", "gender", "ethnicity", "veteran_status", "disability", "signature"]) {
        expect(routeOf(field), `${field} must stay with the person`).toBe("takeover");
      }
    } finally {
      await runner.closeSession();
    }
  }, 60_000);

  it("treats a plain submit button as a submit candidate", async () => {
    const runner = await openPlainForm();
    try {
      const { plan } = await runner.planFill(answers, new Date().toISOString());
      const submit = plan.fields.find((field) => field.isSubmitCandidate);

      expect(submit).toBeDefined();
      expect(submit?.route).toBe("prohibited");
    } finally {
      await runner.closeSession();
    }
  }, 60_000);

  it("fills the ordinary fields through label and name locators alone", async () => {
    const runner = await openPlainForm();
    try {
      const { results } = await runner.fillFields({
        answers,
        valueByFactId: values,
        now: new Date().toISOString(),
      });

      expect(results.map((result) => result.canonicalField).sort()).toEqual(["city", "email", "linkedin", "phone"]);
      expect(results.every((result) => result.applied)).toBe(true);
    } finally {
      await runner.closeSession();
    }
  }, 90_000);

  it("leaves every sensitive question empty even though a fact could answer it", async () => {
    const runner = await openPlainForm();
    try {
      await runner.fillFields({ answers, valueByFactId: values, now: new Date().toISOString() });
      const { snapshot } = await runner.snapshot(new Date().toISOString());

      const stateOfName = (name: string) =>
        snapshot.targets.find((target) =>
          target.locatorRecipes.some((recipe) => recipe.strategy === "name" && recipe.value === name),
        )?.observedValue.state;

      // Verified facts exist for both, and both stay empty.
      expect(stateOfName("candidate[expected_salary]")).toBe("empty");
      expect(stateOfName("eeoc[gender]")).toBe("empty");
      expect(stateOfName("candidate[signature]")).toBe("empty");
      expect(stateOfName("candidate[email]")).toBe("present");
    } finally {
      await runner.closeSession();
    }
  }, 90_000);

  it("reports why each field was understood the way it was", async () => {
    const runner = await openPlainForm();
    try {
      const { plan } = await runner.planFill(answers, new Date().toISOString());
      const email = plan.fields.find((field) => field.canonicalField === "email");

      expect(email?.confidence).toBeGreaterThanOrEqual(0.9);
      expect(email?.evidence.join(" ")).toContain("autocomplete");
      expect(email?.contested).toBe(false);
    } finally {
      await runner.closeSession();
    }
  }, 60_000);
});
