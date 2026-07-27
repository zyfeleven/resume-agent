import { FactSchema, type Fact } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import { EXTRACTOR_VERSION, extractResumeFacts } from "../src/index.js";

const importedAt = "2026-07-27T16:00:00-04:00";

const masterResume = `Maya Chen
maya.chen@example.com | (415) 555-0142 | Toronto, ON | linkedin.com/in/mayachen

SUMMARY
Product designer with eight years shipping enterprise data tools.

SKILLS
Design systems, Figma, Accessibility, Prototyping
Research: Usability testing; Interviewing

EXPERIENCE
Senior Product Designer — Northstar Labs
Jan 2021 – Present
- Led the redesign of the analytics workspace used by 4,000 internal reviewers.
- Built a shared component library adopted by six product teams.

Product Designer — Halcyon Systems
2018 - 2021
- Shipped the first accessible onboarding flow.

EDUCATION
BDes, Interaction Design — Emily Carr University, 2014 - 2018

CERTIFICATIONS
Certified Professional in Accessibility Core Competencies

WORK AUTHORIZATION
Authorized to work in Canada without sponsorship.

PUBLICATIONS
A field guide to enterprise design reviews.

Portal password: hunter2-not-a-real-secret
`;

function importRequest(overrides: Record<string, unknown> = {}) {
  return {
    profileId: "profile:local",
    source: {
      artifactId: "artifact:aaa111",
      fileName: "master-resume.docx",
      format: "docx",
      contentHash: "a".repeat(64),
      byteSize: 24_576,
    },
    text: masterResume,
    importedAt,
    ...overrides,
  };
}

function factByKey(facts: readonly Fact[], key: string): Fact | undefined {
  return facts.find((fact) => fact.key === key);
}

describe("extractResumeFacts", () => {
  it("returns only pending facts that cite a source line", () => {
    const { facts, report } = extractResumeFacts(importRequest());

    expect(facts.length).toBeGreaterThan(10);
    expect(report.extractorVersion).toBe(EXTRACTOR_VERSION);
    expect(report.factIds).toEqual(facts.map((fact) => fact.id));

    for (const fact of facts) {
      expect(FactSchema.parse(fact).status).toBe("pending");
      expect(fact.profileId).toBe("profile:local");
      expect(fact.version).toBe(1);
      expect(fact.createdAt).toBe(importedAt);
      expect(fact.sources).toHaveLength(1);
      expect(fact.sources[0]?.artifactId).toBe("artifact:aaa111");
      expect(fact.sources[0]?.locator).toMatch(/^line:\d+$/);
    }
  });

  it("never emits a value that is absent from its cited source line", () => {
    const { facts } = extractResumeFacts(importRequest());

    for (const fact of facts) {
      const excerpt = fact.sources[0]?.excerpt ?? "";
      expect(typeof fact.value).toBe("string");
      expect(excerpt).toContain(String(fact.value));
    }
  });

  it("separates identity and contact facts from the header block", () => {
    const { facts } = extractResumeFacts(importRequest());

    expect(factByKey(facts, "full_name")?.value).toBe("Maya Chen");
    expect(factByKey(facts, "email")?.value).toBe("maya.chen@example.com");
    expect(factByKey(facts, "phone")?.value).toBe("(415) 555-0142");
    expect(factByKey(facts, "location")?.value).toBe("Toronto, ON");
    expect(factByKey(facts, "linkedin")?.value).toBe("linkedin.com/in/mayachen");
  });

  it("splits an employment entry into role, organization, and dates", () => {
    const { facts } = extractResumeFacts(importRequest());

    expect(factByKey(facts, "employment.northstar-labs.role")?.value).toBe("Senior Product Designer");
    expect(factByKey(facts, "employment.northstar-labs.organization")?.value).toBe("Northstar Labs");
    expect(factByKey(facts, "employment.northstar-labs.dates")?.value).toBe("Jan 2021 – Present");
    expect(factByKey(facts, "employment.northstar-labs.achievement.1")?.value).toBe(
      "Led the redesign of the analytics workspace used by 4,000 internal reviewers.",
    );
    expect(factByKey(facts, "employment.halcyon-systems.dates")?.value).toBe("2018 - 2021");
  });

  it("keeps the source wording when role and organization cannot be separated", () => {
    const { facts } = extractResumeFacts(
      importRequest({ text: "EXPERIENCE\nFreelance product design practice 2016 - 2018\n" }),
    );

    const headline = facts.find((fact) => fact.key.endsWith(".headline"));
    expect(headline?.value).toBe("Freelance product design practice");
    expect(facts.some((fact) => fact.key.endsWith(".role"))).toBe(false);
    expect(facts.some((fact) => fact.key.endsWith(".organization"))).toBe(false);
  });

  it("assigns sensitivity by fact kind", () => {
    const { facts } = extractResumeFacts(importRequest());

    expect(factByKey(facts, "full_name")?.sensitivity).toBe("pii");
    expect(factByKey(facts, "email")?.sensitivity).toBe("pii");
    expect(facts.find((fact) => fact.kind === "skill")?.sensitivity).toBe("normal");

    const workAuthorization = facts.find((fact) => fact.kind === "work_authorization");
    expect(workAuthorization?.value).toBe("Authorized to work in Canada without sponsorship.");
    expect(workAuthorization?.sensitivity).toBe("sensitive");
    expect(facts.every((fact) => fact.sensitivity !== "secret")).toBe(true);
  });

  it("splits a skills line into one fact per skill", () => {
    const { facts } = extractResumeFacts(importRequest());
    const skills = facts.filter((fact) => fact.kind === "skill").map((fact) => fact.value);

    expect(skills).toContain("Design systems");
    expect(skills).toContain("Figma");
    // The group label is dropped instead of being stored as a skill.
    expect(skills).toContain("Usability testing");
    expect(skills).not.toContain("Research");
  });

  it("drops a line that looks like a credential without copying its text", () => {
    const { facts, report } = extractResumeFacts(importRequest());

    const serialized = JSON.stringify({ facts, report });
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("password");
    expect(report.skipped.some((entry) => entry.reason === "possible_secret")).toBe(true);
  });

  it("reports an unmodeled section instead of filing it under the previous section", () => {
    const { facts, report } = extractResumeFacts(importRequest());

    expect(report.sections.some((section) => section.kind === "unrecognized" && section.heading === "PUBLICATIONS")).toBe(
      true,
    );
    expect(facts.some((fact) => String(fact.value).includes("field guide"))).toBe(false);
    expect(report.skipped.some((entry) => entry.reason === "unrecognized_line")).toBe(true);
  });

  it("is deterministic for the same input", () => {
    expect(extractResumeFacts(importRequest())).toEqual(extractResumeFacts(importRequest()));
  });

  it("gives a fact the same id when the same profile re-imports it from another file", () => {
    const first = extractResumeFacts(importRequest());
    const second = extractResumeFacts(
      importRequest({
        source: {
          artifactId: "artifact:bbb222",
          fileName: "master-resume-v2.docx",
          format: "docx",
          contentHash: "b".repeat(64),
          byteSize: 25_000,
        },
        importedAt: "2026-08-01T09:00:00-04:00",
      }),
    );

    expect(second.facts.map((fact) => fact.id)).toEqual(first.facts.map((fact) => fact.id));
    expect(second.report.id).not.toBe(first.report.id);
  });

  it("rejects an import request that does not match the contract", () => {
    expect(() => extractResumeFacts(importRequest({ text: "" }))).toThrow();
    expect(() => extractResumeFacts(importRequest({ localPath: "C:/resumes/master.docx" }))).toThrow();
    expect(() => extractResumeFacts(importRequest({ importedAt: "2026-07-27 16:00" }))).toThrow();
  });
});
