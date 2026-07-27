import { describe, expect, it } from "vitest";

import { ResumeTailorError, buildBaseResume, resumeItems } from "../src/index.js";
import { PROFILE_ID, factByKey, importedFacts, verifiedFacts } from "./fixture.js";

describe("buildBaseResume", () => {
  it("builds a resume only from verified facts", () => {
    const { resume } = buildBaseResume(PROFILE_ID, verifiedFacts());

    expect(resume.profileId).toBe(PROFILE_ID);
    expect(resume.headerFactIds.length).toBeGreaterThan(0);
    expect(resume.skills.map((item) => item.text)).toContain("Figma");
    expect(resume.summary[0]?.text).toBe("Product designer with eight years shipping enterprise data tools.");
    expect(resume.education[0]?.text).toContain("Emily Carr University");
  });

  it("gives every line the fact it came from", () => {
    const facts = verifiedFacts();
    const { resume } = buildBaseResume(PROFILE_ID, facts);
    const factsById = new Map(facts.map((fact) => [fact.id, fact]));

    for (const { item } of resumeItems(resume)) {
      expect(item.factIds.length).toBeGreaterThan(0);
      for (const factId of item.factIds) {
        const fact = factsById.get(factId);
        expect(fact?.status).toBe("verified");
        expect(item.text).toBe(fact?.value);
      }
    }
  });

  it("builds an experience entry from its verified role, organization, and dates", () => {
    const { resume } = buildBaseResume(PROFILE_ID, verifiedFacts());
    const entry = resume.experience[0];

    expect(resume.experience).toHaveLength(1);
    expect(entry?.bullets.map((bullet) => bullet.text)).toEqual([
      "Led the redesign of the analytics workspace used by 4,000 internal reviewers.",
      "Ran the office book club for three years.",
    ]);
  });

  it("skips an experience entry whose organization is not verified", () => {
    const facts = verifiedFacts();
    const organization = factByKey(facts, "employment.northstar-labs.organization");
    const withoutOrganization = facts.filter((fact) => fact.id !== organization.id);

    const { resume, skipped } = buildBaseResume(PROFILE_ID, withoutOrganization);

    expect(resume.experience).toHaveLength(0);
    expect(skipped).toContainEqual({ key: "northstar-labs", reason: "unverified_organization" });
  });

  it("ignores pending facts entirely", () => {
    const facts = verifiedFacts();
    const pending = importedFacts();
    const figma = factByKey(facts, "skill.figma");
    const mixed = [...facts.filter((fact) => fact.id !== figma.id), ...pending.filter((fact) => fact.id === figma.id)];

    const { resume, skipped } = buildBaseResume(PROFILE_ID, mixed);

    expect(resume.skills.map((item) => item.text)).not.toContain("Figma");
    expect(skipped.some((entry) => entry.reason === "unverified_fact")).toBe(true);
  });

  it("refuses to build a resume with no verified identity or contact fact", () => {
    const facts = verifiedFacts().filter((fact) => fact.kind !== "identity" && fact.kind !== "contact");

    expect(() => buildBaseResume(PROFILE_ID, facts)).toThrow(ResumeTailorError);
    expect(() => buildBaseResume(PROFILE_ID, facts)).toThrow(/identity or contact/i);
  });

  it("is deterministic", () => {
    expect(buildBaseResume(PROFILE_ID, verifiedFacts())).toEqual(buildBaseResume(PROFILE_ID, verifiedFacts()));
  });
});
