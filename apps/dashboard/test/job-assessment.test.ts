import type { Fact } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";
import { assessmentInput, assessmentProfileHash, validateAssessment } from "../lib/job-assessment";
import { emptyProfileStore } from "../lib/profile-store";
import type { DiscoveredJob } from "../lib/discovery-model";

const now = "2026-09-16T12:00:00.000Z";
const fact = (id: string, sensitivity: Fact["sensitivity"] = "normal"): Extract<Fact, { status: "verified" }> => ({ id, key: `skills.${id}`, value: "Python", kind: "skill", profileId: "profile:local", sensitivity,
  sources: [{ artifactId: "artifact:cv", locator: "line:1", excerpt: "Python" }], status: "verified", version: 1,
  verification: { verifiedAt: now, verifiedBy: "user" }, createdAt: now, updatedAt: now });
function pendingFact(id: string): Fact {
  const { verification: _verification, ...rest } = fact(id);
  return { ...rest, status: "pending" };
}
const job: DiscoveredJob = { id: "discovered:test", provider: "lever", board: "test", externalId: "1", company: "Example", title: "Software Engineer", location: "Ottawa", url: "https://jobs.lever.co/test/1", description: "Requirements\nPython experience required.\nPreferred qualifications\nSQL experience is a plus.", fingerprint: "a".repeat(64), firstSeenAt: now, lastSeenAt: now, sourceUpdatedAt: null, availability: "open", decision: "new", decisionHash: null };
const input: ReturnType<typeof assessmentInput> = { job: { title: "Software Engineer", company: "Example" }, requirements: [{ id: "r:python", text: "Python experience", priority: "must_have" }, { id: "r:sql", text: "SQL", priority: "preferred" }], facts: [{ id: "f:python", key: "skills.python", kind: "skill", value: "Python" }] };
const output = { summary: "Python is evidenced; SQL is missing.", matches: [
  { requirementId: "r:python", support: "supported", factIds: ["f:python"], reason: "Verified Python skill." },
  { requirementId: "r:sql", support: "missing", factIds: [], reason: "No SQL fact." },
] };

describe("Gemini shortlist evidence", () => {
  it("withholds PII and unverified facts from assessment inputs", () => {
    const profile = { ...emptyProfileStore(), facts: [fact("fact:normal"), { ...fact("fact:email", "pii"), value: "private@example.test" }, pendingFact("fact:pending")] };
    const request = assessmentInput(job, profile);
    expect(request.facts.map((f) => f.id)).toEqual(["fact:normal"]);
    expect(JSON.stringify(request)).not.toContain("private@example.test");
    expect(request.requirements.length).toBeGreaterThan(0);
  });
  it("weights grounded must-have coverage without manufacturing a hiring probability", () => {
    expect(validateAssessment(input, output).score).toBe(75);
    const partial = structuredClone(output);
    partial.matches[0]!.support = "partial";
    expect(validateAssessment(input, partial).score).toBe(38);
  });
  it("rejects unknown facts, missing evidence, duplicates and incomplete requirement coverage", () => {
    const unknown = structuredClone(output); unknown.matches[0]!.factIds = ["invented"];
    expect(() => validateAssessment(input, unknown)).toThrow(/evidence IDs/);
    const uncited = structuredClone(output); uncited.matches[0]!.factIds = [];
    expect(() => validateAssessment(input, uncited)).toThrow(/evidence IDs/);
    const duplicate = structuredClone(output); duplicate.matches[1]!.requirementId = "r:python";
    expect(() => validateAssessment(input, duplicate)).toThrow(/exactly once/);
    expect(() => validateAssessment(input, { ...output, matches: [output.matches[0]] })).toThrow(/exactly once/);
  });
  it("changes assessment freshness when verified evidence is revoked", () => {
    const profile = { ...emptyProfileStore(), facts: [fact("fact:normal")] };
    const revoked = { ...profile, facts: [pendingFact("fact:normal")] };
    expect(assessmentProfileHash(profile)).not.toBe(assessmentProfileHash(revoked));
    expect(() => assessmentInput(job, revoked)).toThrow(/Verify/);
  });
});
