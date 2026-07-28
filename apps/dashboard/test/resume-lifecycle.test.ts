import type { Fact } from "@resume-agent/contracts";
import { parseJobDescription } from "@resume-agent/jd-analysis";
import { extractResumeFacts, factReviewHash, reviewFact } from "@resume-agent/resume-import";
import { buildBaseResume, checkChangeSetClaims, generateChangeSet } from "@resume-agent/resume-tailor";
import { describe, expect, it } from "vitest";

import { approveResumeContent, recordDocumentBuild } from "../lib/resume-lifecycle";

const GENERATED_AT = "2026-07-28T04:30:00-04:00";
const PROFILE_ID = "profile:local";
const JOB_ID = "job:lifecycle";

function verifiedFacts(): Fact[] {
  const pending = extractResumeFacts({
    profileId: PROFILE_ID,
    source: {
      artifactId: "artifact:resume",
      fileName: "resume.txt",
      format: "plain_text",
      contentHash: "a".repeat(64),
      byteSize: 100,
    },
    text: "Maya Chen\nmaya@example.com\n\nSKILLS\nTypeScript",
    importedAt: "2026-07-28T04:00:00-04:00",
  }).facts;
  return pending.map((fact) =>
    reviewFact(fact, {
      decision: "verify",
      factId: fact.id,
      reviewedValueHash: factReviewHash(fact),
      verifiedBy: "user",
      decidedAt: "2026-07-28T04:15:00-04:00",
    }),
  );
}

function requirements() {
  return parseJobDescription({
    jobId: JOB_ID,
    source: { artifactId: "artifact:job", contentHash: "b".repeat(64), byteSize: 100 },
    text: "Requirements\n- Experience with TypeScript.",
    parsedAt: "2026-07-28T04:00:00-04:00",
  }).requirements;
}

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
  const guard = checkChangeSetClaims({
    changeSet: generated.changeSet,
    baseResume: base.resume,
    facts,
    requirements: jobRequirements,
    checkedAt: GENERATED_AT,
  });
  return { facts, guard, ...generated };
}

describe("dashboard resume lifecycle integration", () => {
  it("takes fact-backed reviewed content to user-approved", () => {
    const { facts, guard, changeSet, tailoredResume } = scenario();
    expect(
      approveResumeContent({
        resumeVersionId: "resume-version:approved",
        approvedContentHash: changeSet.resultContentHash,
        changeSetId: changeSet.id,
        changeSet,
        guard,
        resume: tailoredResume,
        facts,
        occurredAt: GENERATED_AT,
      }).status,
    ).toBe("user_approved");
  });

  it("refuses approval when a cited fact is no longer verified", () => {
    const { facts, guard, changeSet, tailoredResume } = scenario();
    const downgraded = facts.map((fact, index) =>
      index === 0 ? ({ ...fact, status: "pending" } as Fact) : fact,
    );
    expect(() =>
      approveResumeContent({
        resumeVersionId: "resume-version:approved",
        approvedContentHash: changeSet.resultContentHash,
        changeSetId: changeSet.id,
        changeSet,
        guard,
        resume: tailoredResume,
        facts: downgraded,
        occurredAt: GENERATED_AT,
      }),
    ).toThrow(/referenced fact must be verified/i);
  });

  it("refuses the docx-built transition when verification failed", () => {
    const { facts, guard, changeSet, tailoredResume } = scenario();
    expect(() =>
      recordDocumentBuild({
        resumeVersionId: "resume-version:approved",
        approvedContentHash: changeSet.resultContentHash,
        changeSetId: changeSet.id,
        changeSet,
        guard,
        resume: tailoredResume,
        facts,
        occurredAt: GENERATED_AT,
        artifactId: "artifact:docx",
        artifactHash: "a".repeat(64),
        manifestArtifactId: "manifest:docx",
        buildVerified: false,
      }),
    ).toThrow(/manifest does not match/i);
  });
});
