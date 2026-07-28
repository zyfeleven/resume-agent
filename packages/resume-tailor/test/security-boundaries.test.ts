import type { Fact, ResumeChangeSet, ResumeIR } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import {
  applyReviewedChanges,
  buildBaseResume,
  checkChangeSetClaims,
  generateChangeSet,
  matchRequirement,
} from "../src/index.js";
import {
  GENERATED_AT,
  JOB_ID,
  PROFILE_ID,
  importedFacts,
  requirements,
  verifiedFacts,
} from "./fixture.js";

function scenario() {
  const facts = verifiedFacts();
  const base = buildBaseResume(PROFILE_ID, facts);
  const jobRequirements = requirements();
  const generated = generateChangeSet({
    jobId: JOB_ID,
    profileId: PROFILE_ID,
    baseResume: base.resume,
    baseResumeVersionId: "resume-version:base",
    requirements: jobRequirements,
    facts,
    generatedAt: GENERATED_AT,
  });
  return { facts, base, jobRequirements, ...generated };
}

describe("profile and review boundaries", () => {
  it("keeps verified facts from another profile out of the base resume", () => {
    const foreign: Fact = {
      ...verifiedFacts()[0]!,
      id: "fact:foreign-name",
      profileId: "profile:someone-else",
      value: "Someone Else",
    };

    const { resume } = buildBaseResume(PROFILE_ID, [...verifiedFacts(), foreign]);
    const citedIds = [
      ...resume.headerFactIds,
      ...resume.summary.flatMap((item) => item.factIds),
      ...resume.skills.flatMap((item) => item.factIds),
      ...resume.projects.flatMap((item) => item.factIds),
      ...resume.education.flatMap((item) => item.factIds),
      ...resume.experience.flatMap((entry) => [
        entry.roleFactId,
        entry.organizationFactId,
        ...entry.dateFactIds,
        ...entry.bullets.flatMap((item) => item.factIds),
      ]),
    ];

    expect(citedIds).not.toContain(foreign.id);
  });

  it("does not let the exported single-requirement matcher use a pending fact", () => {
    const pendingFigma = importedFacts().find((fact) => fact.key === "skill.figma");
    const figmaRequirement = requirements().find((requirement) => requirement.text.includes("Figma"));
    expect(pendingFigma).toBeDefined();
    expect(figmaRequirement).toBeDefined();

    expect(matchRequirement(figmaRequirement!, [pendingFigma!]).strength).toBe("missing");
  });

  it("refuses to apply a change set to a different base resume", () => {
    const { base, changeSet } = scenario();
    const firstSkill = base.resume.skills[0];
    expect(firstSkill).toBeDefined();
    const changedBase: ResumeIR = {
      ...base.resume,
      skills: base.resume.skills.map((item, index) =>
        index === 0 ? { ...item, text: `${item.text} changed` } : item,
      ),
    };

    expect(() => applyReviewedChanges(changedBase, changeSet, [])).toThrow(/base resume changed/i);
  });
});

describe("claim-guard structural boundaries", () => {
  it("rejects a citation to a verified fact owned by another profile", () => {
    const { facts, base, jobRequirements, changeSet } = scenario();
    const firstChange = changeSet.changes[0]!;
    const foreign: Fact = {
      ...facts.find((fact) => fact.id === firstChange.factIds[0])!,
      id: "fact:foreign-profile",
      profileId: "profile:someone-else",
    };
    const tampered: ResumeChangeSet = {
      ...changeSet,
      changes: changeSet.changes.map((change, index) =>
        index === 0 ? { ...change, factIds: [foreign.id] } : change,
      ),
    };

    const report = checkChangeSetClaims({
      changeSet: tampered,
      baseResume: base.resume,
      facts: [...facts, foreign],
      requirements: jobRequirements,
      checkedAt: GENERATED_AT,
    });

    expect(report.passed).toBe(false);
    expect(report.violations.some((violation) => violation.detail.includes("another profile"))).toBe(true);
  });

  it("rejects a change whose target item is absent from the base resume", () => {
    const { facts, base, jobRequirements, changeSet } = scenario();
    const tampered: ResumeChangeSet = {
      ...changeSet,
      changes: changeSet.changes.map((change, index) =>
        index === 0 ? { ...change, targetItemId: "item:not-in-base" } : change,
      ),
    };

    const report = checkChangeSetClaims({
      changeSet: tampered,
      baseResume: base.resume,
      facts,
      requirements: jobRequirements,
      checkedAt: GENERATED_AT,
    });

    expect(report.passed).toBe(false);
    expect(report.violations.some((violation) => violation.detail.includes("not present"))).toBe(true);
  });

  it("rejects a change set bound to a different base-content hash", () => {
    const { facts, base, jobRequirements, changeSet } = scenario();
    const report = checkChangeSetClaims({
      changeSet: { ...changeSet, baseContentHash: "9".repeat(64) },
      baseResume: base.resume,
      facts,
      requirements: jobRequirements,
      checkedAt: GENERATED_AT,
    });

    expect(report.passed).toBe(false);
    expect(report.violations.some((violation) => violation.detail.includes("base resume"))).toBe(true);
  });

  it("rejects requirement corrections made after generation", () => {
    const { facts, base, jobRequirements, changeSet } = scenario();
    const corrected = jobRequirements.map((requirement, index) =>
      index === 0 ? { ...requirement, priority: "preferred" as const } : requirement,
    );
    const report = checkChangeSetClaims({
      changeSet,
      baseResume: base.resume,
      facts,
      requirements: corrected,
      checkedAt: GENERATED_AT,
    });

    expect(report.passed).toBe(false);
    expect(report.violations.some((violation) => violation.detail.includes("requirements changed"))).toBe(true);
  });
});
