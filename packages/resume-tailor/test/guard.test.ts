import type { ResumeChangeSet } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import { buildBaseResume, checkChangeSetClaims, generateChangeSet } from "../src/index.js";
import { GENERATED_AT, JOB_ID, PROFILE_ID, factByKey, requirements, verifiedFacts } from "./fixture.js";

const CHECKED_AT = "2026-07-27T17:05:00-04:00";

function scenario() {
  const facts = verifiedFacts();
  const jobRequirements = requirements();
  const { resume } = buildBaseResume(PROFILE_ID, facts);
  const { changeSet } = generateChangeSet({
    jobId: JOB_ID,
    profileId: PROFILE_ID,
    baseResume: resume,
    baseResumeVersionId: "resume-version:base",
    requirements: jobRequirements,
    facts,
    generatedAt: GENERATED_AT,
  });

  return { facts, requirements: jobRequirements, baseResume: resume, changeSet };
}

function guard(changeSet: ResumeChangeSet, overrides: Partial<ReturnType<typeof scenario>> = {}) {
  const base = scenario();
  return checkChangeSetClaims({
    changeSet,
    baseResume: overrides.baseResume ?? base.baseResume,
    facts: overrides.facts ?? base.facts,
    requirements: overrides.requirements ?? base.requirements,
    checkedAt: CHECKED_AT,
  });
}

/** A change of the shape a model would produce once generated prose is introduced. */
function withRewrite(changeSet: ResumeChangeSet, after: string, factIds?: string[]): ResumeChangeSet {
  const target = changeSet.changes.find((change) => change.intent === "keep");
  if (!target) {
    throw new Error("fixture produced no kept change");
  }
  return {
    ...changeSet,
    changes: [
      ...changeSet.changes.filter((change) => change.id !== target.id),
      {
        id: target.id,
        intent: "rewrite",
        targetItemId: target.targetItemId,
        factIds: factIds ?? target.factIds,
        requirementIds: target.requirementIds,
        rationale: "Reworded for the posting.",
        before: Array.isArray(target.before) ? target.before.join(" ") : target.before,
        after,
      },
    ],
  };
}

describe("checkChangeSetClaims", () => {
  it("passes a change set built by selection", () => {
    const { changeSet } = scenario();
    const report = guard(changeSet);

    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.guardVersion).toBe("claim-guard-v1");
  });

  it("rejects a change that cites a fact the user never verified", () => {
    const { changeSet, facts } = scenario();
    const figma = factByKey(facts, "skill.figma");
    const downgraded = facts.map((fact) =>
      fact.id === figma.id ? { ...fact, status: "pending" as const, version: fact.version } : fact,
    );

    const report = guard(changeSet, { facts: downgraded });

    expect(report.passed).toBe(false);
    expect(report.violations.some((violation) => violation.code === "fact_not_verified")).toBe(true);
  });

  it("rejects a change that cites a fact from another profile", () => {
    const { changeSet } = scenario();
    const tampered: ResumeChangeSet = {
      ...changeSet,
      changes: changeSet.changes.map((change, index) =>
        index === 0 ? { ...change, factIds: ["fact:not-in-this-profile"] } : change,
      ),
    };

    expect(guard(tampered).violations.some((violation) => violation.code === "fact_not_in_snapshot")).toBe(true);
  });

  it("rejects a change that cites a requirement from another job", () => {
    const { changeSet } = scenario();
    const tampered: ResumeChangeSet = {
      ...changeSet,
      changes: changeSet.changes.map((change, index) =>
        index === 0 ? { ...change, requirementIds: ["requirement:from-another-posting"] } : change,
      ),
    };

    expect(guard(tampered).violations.some((violation) => violation.code === "requirement_not_in_snapshot")).toBe(true);
  });

  it("rejects a change that misreports the wording it is replacing", () => {
    const { changeSet } = scenario();
    const tampered: ResumeChangeSet = {
      ...changeSet,
      changes: changeSet.changes.map((change, index) =>
        index === 0 && change.intent !== "combine" ? { ...change, before: "Something the resume never said" } : change,
      ),
    };

    expect(guard(tampered).violations.some((violation) => violation.code === "before_text_altered")).toBe(true);
  });

  it("rejects proposed wording that introduces experience the facts do not support", () => {
    const { changeSet } = scenario();
    const invented = withRewrite(changeSet, "Led a team of engineers across three countries.");

    const report = guard(invented);
    expect(report.passed).toBe(false);
    expect(report.violations.some((violation) => violation.code === "unsupported_claim")).toBe(true);
  });

  it("rejects proposed wording that invents a metric", () => {
    const { changeSet, facts } = scenario();
    const achievement = facts.find((fact) => String(fact.value).includes("4,000 internal reviewers"));
    const inflated = withRewrite(
      changeSet,
      "Led the redesign of the analytics workspace used by 40,000 internal reviewers.",
      achievement ? [achievement.id] : undefined,
    );

    const report = guard(inflated);
    expect(report.passed).toBe(false);
    expect(report.violations.some((violation) => violation.code === "unsupported_number")).toBe(true);
  });

  it("accepts proposed wording that only rearranges the cited fact", () => {
    const { changeSet, facts } = scenario();
    const achievement = facts.find((fact) => String(fact.value).includes("4,000 internal reviewers"));
    const reworded = withRewrite(
      changeSet,
      "Redesign of the analytics workspace, used by 4,000 internal reviewers.",
      achievement ? [achievement.id] : undefined,
    );

    const violations = guard(reworded).violations.filter(
      (violation) => violation.code === "unsupported_claim" || violation.code === "unsupported_number",
    );
    expect(violations).toEqual([]);
  });

  it("rejects a change set generated before the facts changed", () => {
    const { changeSet, facts } = scenario();
    const figma = factByKey(facts, "skill.figma");
    const edited = facts.map((fact) => (fact.id === figma.id ? { ...fact, value: "Sketch" } : fact));

    const report = guard(changeSet, { facts: edited });

    expect(report.passed).toBe(false);
    expect(report.violations.some((violation) => violation.code === "fact_snapshot_mismatch")).toBe(true);
  });
});
