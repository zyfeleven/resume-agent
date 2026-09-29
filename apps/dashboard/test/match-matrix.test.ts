import {
  FactSchema,
  JDRequirementSchema,
  RequirementFactMatchSchema,
  type Fact,
} from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import { toMatchMatrix } from "../lib/resume-payload";
import { ResumeStoreSchema, emptyResumeStore } from "../lib/resume-store";

const now = "2026-07-28T09:00:00-04:00";

function verifiedFact(id: string, value: string, artifactId: string): Fact {
  return FactSchema.parse({
    id,
    profileId: "profile:local",
    kind: "skill",
    key: `skills.${value.toLowerCase()}`,
    value,
    status: "verified",
    verification: { verifiedBy: "user", verifiedAt: now },
    sensitivity: "normal",
    sources: [{ artifactId, locator: "line:8", excerpt: value }],
    version: 2,
    createdAt: now,
    updatedAt: now,
  });
}

const requirement = JDRequirementSchema.parse({
  id: "requirement:figma",
  jobId: "job:designer",
  kind: "skill",
  priority: "must_have",
  text: "Proficiency in Figma.",
  keywords: ["Figma"],
  source: { artifactId: "artifact:jd", locator: "line:4", excerpt: "Proficiency in Figma." },
});

function match(factIds: string[]) {
  return RequirementFactMatchSchema.parse({
    requirementId: requirement.id,
    factIds,
    strength: "exact",
    rationale: "Verified facts contain the posting's stated wording: Figma.",
    confidence: 0.9,
    evidence: factIds.map((factId) => ({ factId, basis: "keyword", terms: ["Figma"] })),
  });
}

const sourceFileNames = {
  "artifact:jd": "product-designer.txt",
  "artifact:resume-old": "resume-old.docx",
  "artifact:resume-new": "resume-new.docx",
};

describe("JD-to-fact match matrix", () => {
  it("keeps pre-sentence-review resume stores readable", () => {
    const migrated = ResumeStoreSchema.parse({
      ...emptyResumeStore(),
      sentenceReviews: undefined,
      semanticGuardReports: undefined,
    });
    expect(migrated.sentenceReviews).toEqual([]);
    expect(migrated.semanticGuardReports).toEqual([]);
  });

  it("cites the requirement source, fact source, and actual matching terms", () => {
    const fact = verifiedFact("fact:figma", "Figma", "artifact:resume-old");
    const row = toMatchMatrix({
      matches: [match([fact.id])],
      facts: [fact],
      requirements: [requirement],
      descriptionArtifactId: "artifact:jd",
      sourceFileNames,
    })[0];

    expect(row).toMatchObject({
      strength: "exact",
      source: { fileName: "product-designer.txt", locator: "line:4" },
      facts: [
        {
          factId: fact.id,
          basis: "keyword",
          terms: ["Figma"],
          sources: [{ fileName: "resume-old.docx", locator: "line:8" }],
        },
      ],
    });
  });

  it("shows disputed evidence but never counts it as support", () => {
    const disputed = verifiedFact("fact:figma:old", "Figma", "artifact:resume-old");
    const row = toMatchMatrix({
      matches: [match([disputed.id])],
      facts: [],
      allFacts: [disputed],
      blockedFactIds: [disputed.id],
      requirements: [requirement],
      descriptionArtifactId: "artifact:jd",
      sourceFileNames,
    })[0];

    expect(row?.strength).toBe("conflict");
    expect(row?.confidence).toBe(0);
    expect(row?.facts.map((fact) => fact.factId)).toEqual([disputed.id]);
  });

  it("keeps conflict-free support and removes disputed candidates from the row", () => {
    const disputed = verifiedFact("fact:figma:old", "Figma", "artifact:resume-old");
    const safe = verifiedFact("fact:figma:new", "Figma", "artifact:resume-new");
    const row = toMatchMatrix({
      matches: [match([disputed.id, safe.id])],
      facts: [safe],
      allFacts: [disputed, safe],
      blockedFactIds: [disputed.id],
      requirements: [requirement],
      descriptionArtifactId: "artifact:jd",
      sourceFileNames,
    })[0];

    expect(row?.strength).toBe("exact");
    expect(row?.facts.map((fact) => fact.factId)).toEqual([safe.id]);
    expect(row?.rationale).toContain("Disputed candidates were excluded");
  });

  it("downgrades a historical match when its fact is no longer verified", () => {
    const oldFact = verifiedFact("fact:figma", "Figma", "artifact:resume-old");
    const row = toMatchMatrix({
      matches: [match([oldFact.id])],
      facts: [],
      allFacts: [oldFact],
      requirements: [requirement],
      descriptionArtifactId: "artifact:jd",
      sourceFileNames,
    })[0];

    expect(row).toMatchObject({ strength: "missing", confidence: 0, facts: [] });
  });
});
