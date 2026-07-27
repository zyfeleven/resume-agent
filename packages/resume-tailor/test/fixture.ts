import type { Fact, JDRequirement } from "@resume-agent/contracts";
import { extractResumeFacts, reviewFact, factReviewHash } from "@resume-agent/resume-import";
import { parseJobDescription } from "@resume-agent/jd-analysis";

export const PROFILE_ID = "profile:local";
export const JOB_ID = "job:northstar-designer";
export const IMPORTED_AT = "2026-07-27T16:00:00-04:00";
export const VERIFIED_AT = "2026-07-27T16:30:00-04:00";
export const GENERATED_AT = "2026-07-27T17:00:00-04:00";

const resumeText = `Maya Chen
maya.chen@example.com | Toronto, ON

SUMMARY
Product designer with eight years shipping enterprise data tools.

SKILLS
Design systems, Figma, Accessibility, Woodworking

EXPERIENCE
Senior Product Designer — Northstar Labs
Jan 2021 – Present
- Led the redesign of the analytics workspace used by 4,000 internal reviewers.
- Ran the office book club for three years.

EDUCATION
BDes, Interaction Design — Emily Carr University
`;

const jobText = `What you'll need
- 5+ years of product design experience.
- Proficiency in Figma and design systems.
- Experience with accessibility standards.

Nice to have
- Experience with Kubernetes.
`;

/** All facts an import produces, still pending. */
export function importedFacts(): Fact[] {
  return extractResumeFacts({
    profileId: PROFILE_ID,
    source: {
      artifactId: "artifact:resume1",
      fileName: "master-resume.docx",
      format: "docx",
      contentHash: "a".repeat(64),
      byteSize: 24_576,
    },
    text: resumeText,
    importedAt: IMPORTED_AT,
  }).facts;
}

/** The same facts after the user verified every one of them. */
export function verifiedFacts(): Fact[] {
  return importedFacts().map((fact) =>
    reviewFact(fact, {
      decision: "verify",
      factId: fact.id,
      reviewedValueHash: factReviewHash(fact),
      verifiedBy: "user",
      decidedAt: VERIFIED_AT,
    }),
  );
}

export function requirements(): JDRequirement[] {
  return parseJobDescription({
    jobId: JOB_ID,
    source: { artifactId: "artifact:jd1", contentHash: "c".repeat(64), byteSize: 640 },
    text: jobText,
    parsedAt: IMPORTED_AT,
  }).requirements;
}

export function factByKey(facts: readonly Fact[], key: string): Fact {
  const fact = facts.find((candidate) => candidate.key === key);
  if (!fact) {
    throw new Error(`fixture has no fact with key ${key}`);
  }
  return fact;
}
