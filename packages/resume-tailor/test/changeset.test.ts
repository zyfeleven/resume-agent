import type { ResumeChange } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import { buildBaseResume, generateChangeSet, matchRequirements } from "../src/index.js";
import { GENERATED_AT, JOB_ID, PROFILE_ID, requirements, verifiedFacts } from "./fixture.js";

function generate() {
  const facts = verifiedFacts();
  const { resume } = buildBaseResume(PROFILE_ID, facts);
  return {
    facts,
    baseResume: resume,
    ...generateChangeSet({
      jobId: JOB_ID,
      profileId: PROFILE_ID,
      baseResume: resume,
      baseResumeVersionId: "resume-version:base",
      requirements: requirements(),
      facts,
      generatedAt: GENERATED_AT,
    }),
  };
}

function changeFor(changes: readonly ResumeChange[], text: string): ResumeChange | undefined {
  return changes.find((change) => (Array.isArray(change.before) ? change.before.join(" ") : change.before).includes(text));
}

describe("matchRequirements", () => {
  it("matches a requirement to the verified fact that states its keyword", () => {
    const facts = verifiedFacts();
    const matches = matchRequirements(requirements(), facts);
    const figma = matches.find((match) =>
      match.factIds.some((factId) => facts.find((fact) => fact.id === factId)?.value === "Figma"),
    );

    expect(figma?.strength).toBe("exact");
    expect(figma?.confidence).toBeGreaterThan(0.8);
    expect(figma?.evidence.some((entry) => entry.terms.some((term) => term.toLowerCase() === "figma"))).toBe(true);
  });

  it("reports a requirement with no supporting fact as missing", () => {
    const matches = matchRequirements(requirements(), verifiedFacts());
    const kubernetes = matches.find((match) => match.rationale.includes("No verified fact"));

    expect(kubernetes?.strength).toBe("missing");
    expect(kubernetes?.factIds).toEqual([]);
    expect(kubernetes?.confidence).toBe(0);
  });

  it("never matches a requirement against an unverified fact", () => {
    expect(matchRequirements(requirements(), verifiedFacts().map((fact) => ({ ...fact, status: "pending" as const })))
      .every((match) => match.strength === "missing")).toBe(true);
  });

  it("reports a matching but disputed verified fact as a conflict, never as support", () => {
    const facts = verifiedFacts();
    const figmaFact = facts.find((fact) => fact.value === "Figma");
    const figmaRequirement = requirements().find((requirement) =>
      requirement.keywords.some((keyword) => keyword.toLowerCase() === "figma"),
    );
    if (!figmaFact || !figmaRequirement) throw new Error("fixture has no Figma match");
    const focusedRequirement = { ...figmaRequirement, text: "Proficiency in Figma.", keywords: ["Figma"] };

    const match = matchRequirements([focusedRequirement], facts, { blockedFactIds: [figmaFact.id] })[0];

    expect(match?.strength).toBe("conflict");
    expect(match?.confidence).toBe(0);
    expect(match?.factIds).toEqual([figmaFact.id]);
    expect(match?.rationale).toContain("cannot satisfy");
  });

  it("uses conflict-free support while excluding a disputed matching fact", () => {
    const facts = verifiedFacts();
    const figmaFact = facts.find((fact) => fact.value === "Figma");
    const figmaRequirement = requirements().find((requirement) =>
      requirement.keywords.some((keyword) => keyword.toLowerCase() === "figma"),
    );
    if (!figmaFact || !figmaRequirement) throw new Error("fixture has no Figma match");
    const focusedRequirement = { ...figmaRequirement, text: "Proficiency in Figma.", keywords: ["Figma"] };
    const safeDuplicate = { ...figmaFact, id: "fact:figma:safe" };

    const match = matchRequirements([focusedRequirement], [...facts, safeDuplicate], {
      blockedFactIds: [figmaFact.id],
    })[0];

    expect(match?.strength).toBe("exact");
    expect(match?.factIds).toEqual([safeDuplicate.id]);
    expect(match?.evidence.map((entry) => entry.factId)).toEqual([safeDuplicate.id]);
  });
});

describe("generateChangeSet", () => {
  it("keeps a line the job asks for and cites the requirement it answers", () => {
    const { changeSet } = generate();
    const figma = changeFor(changeSet.changes, "Figma");

    expect(figma?.intent).toBe("keep");
    expect(figma?.requirementIds.length).toBeGreaterThan(0);
    expect(figma?.factIds.length).toBeGreaterThan(0);
    expect(figma?.rationale).toContain("supports");
  });

  it("removes a line no requirement asks for", () => {
    const { changeSet } = generate();

    expect(changeFor(changeSet.changes, "Woodworking")?.intent).toBe("remove");
    expect(changeFor(changeSet.changes, "office book club")?.intent).toBe("remove");
  });

  it("cites at least one verified fact on every change", () => {
    const { changeSet, facts } = generate();
    const verifiedIds = new Set(facts.filter((fact) => fact.status === "verified").map((fact) => fact.id));

    for (const change of changeSet.changes) {
      expect(change.factIds.length).toBeGreaterThan(0);
      for (const factId of change.factIds) {
        expect(verifiedIds.has(factId)).toBe(true);
      }
    }
  });

  it("records that no model produced this content", () => {
    const { changeSet } = generate();

    expect(changeSet.model).toBe("deterministic-selector");
    expect(changeSet.changes.every((change) => change.intent === "keep" || change.intent === "remove")).toBe(true);
  });

  it("drops removed lines from the tailored resume and keeps the rest", () => {
    const { tailoredResume, baseResume } = generate();

    expect(tailoredResume.skills.map((item) => item.text)).toContain("Figma");
    expect(tailoredResume.skills.map((item) => item.text)).not.toContain("Woodworking");
    expect(tailoredResume.skills.length).toBeLessThan(baseResume.skills.length);
    // The entry itself survives on its own verified role, organization, and dates.
    expect(tailoredResume.experience).toHaveLength(1);
  });

  it("marks each surviving line with the requirements it answers", () => {
    const { tailoredResume } = generate();

    for (const item of tailoredResume.skills) {
      expect(item.requirementIds.length).toBeGreaterThan(0);
    }
  });

  it("reports coverage for every requirement, including the ones nothing supports", () => {
    const { report, changeSet } = generate();

    expect(report.coverage).toHaveLength(requirements().length);
    expect(report.coverage.some((entry) => entry.strength === "missing")).toBe(true);
    expect(report.keptItemCount + report.removedItemCount).toBe(changeSet.changes.length);
    expect(report.verifiedFactCount).toBeGreaterThan(0);
  });

  it("binds the change set to the facts and requirements it was generated from", () => {
    const first = generate();
    const second = generate();

    expect(first.changeSet).toEqual(second.changeSet);
    expect(first.changeSet.factSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.changeSet.requirementSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.changeSet.baseContentHash).not.toBe(first.changeSet.resultContentHash);
  });
});
