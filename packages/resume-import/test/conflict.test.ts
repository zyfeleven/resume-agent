import { FactSchema, type Fact } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import {
  ResumeImportError,
  conflictedFactIds,
  detectFactConflicts,
  resolveFactConflict,
  usableFacts,
} from "../src/index.js";

const createdAt = "2026-07-28T09:00:00-04:00";
const decidedAt = "2026-07-28T10:00:00-04:00";

function fact(id: string, value: string, overrides: Record<string, unknown> = {}): Fact {
  return FactSchema.parse({
    id,
    profileId: "profile:local",
    kind: "contact",
    key: "contact.location",
    value,
    status: "pending",
    sensitivity: "pii",
    sources: [{ artifactId: `artifact:${id}`, locator: "header:2", excerpt: value }],
    version: 1,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });
}

describe("fact conflict review", () => {
  it("detects distinct active values for the same canonical key", () => {
    const first = fact("fact:toronto", "Toronto, ON");
    const second = fact("fact:montreal", "Montreal, QC");
    const conflicts = detectFactConflicts([first, second]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      profileId: "profile:local",
      kind: "contact",
      key: "contact.location",
      candidateFactIds: ["fact:montreal", "fact:toronto"],
    });
    expect(conflicts[0]?.reviewedConflictHash).toMatch(/^[a-f0-9]{64}$/);
    expect([...conflictedFactIds([first, second])].sort()).toEqual(["fact:montreal", "fact:toronto"]);
  });

  it("does not create a conflict for repeated evidence of the same value", () => {
    expect(detectFactConflicts([fact("fact:first", "Toronto, ON"), fact("fact:second", "Toronto, ON")])).toEqual([]);
  });

  it("treats object values as equal regardless of property insertion order", () => {
    const first = fact("fact:first", "unused", { value: { city: "Toronto", region: "ON" } });
    const second = fact("fact:second", "unused", { value: { region: "ON", city: "Toronto" } });

    expect(detectFactConflicts([first, second])).toEqual([]);
  });

  it("blocks every candidate, including a previously verified fact, from downstream use", () => {
    const verified = fact("fact:verified", "Toronto, ON", {
      status: "verified",
      verification: { verifiedBy: "user", verifiedAt: createdAt },
    });
    const competing = fact("fact:pending", "Montreal, QC");
    const unrelated = fact("fact:email", "maya@example.com", { key: "contact.email" });

    expect(usableFacts([verified, competing, unrelated]).map((candidate) => candidate.id)).toEqual(["fact:email"]);
  });

  it("binds the review hash to status and all source evidence", () => {
    const first = fact("fact:toronto", "Toronto, ON");
    const second = fact("fact:montreal", "Montreal, QC");
    const original = detectFactConflicts([first, second])[0];
    const withEvidence = FactSchema.parse({
      ...second,
      sources: [...second.sources, { artifactId: "artifact:new", locator: "contact:4", excerpt: "Montreal, QC" }],
    });
    const updated = detectFactConflicts([first, withEvidence])[0];

    expect(updated?.id).toBe(original?.id);
    expect(updated?.reviewedConflictHash).not.toBe(original?.reviewedConflictHash);
  });

  it("verifies the selected value, rejects alternatives, and records provenance", () => {
    const facts = [fact("fact:toronto", "Toronto, ON"), fact("fact:montreal", "Montreal, QC")];
    const conflict = detectFactConflicts(facts)[0];
    if (!conflict) throw new Error("fixture did not create a conflict");

    const result = resolveFactConflict(facts, {
      conflictId: conflict.id,
      selectedFactId: "fact:toronto",
      reviewedConflictHash: conflict.reviewedConflictHash,
      decidedBy: "user:local",
      decidedAt,
    });

    expect(result.facts.find((candidate) => candidate.id === "fact:toronto")).toMatchObject({
      status: "verified",
      verification: { verifiedBy: "user", verifiedAt: decidedAt },
      version: 2,
    });
    expect(result.facts.find((candidate) => candidate.id === "fact:montreal")).toMatchObject({
      status: "rejected",
      rejection: { rejectedBy: "user:local", rejectedAt: decidedAt },
      version: 2,
    });
    expect(result.decision).toMatchObject({
      conflictId: conflict.id,
      selectedFactId: "fact:toronto",
      reviewedConflictHash: conflict.reviewedConflictHash,
      decidedBy: "user:local",
    });
    expect(detectFactConflicts(result.facts)).toEqual([]);
  });

  it("fails closed when the evidence hash is stale or the selection is outside the conflict", () => {
    const facts = [fact("fact:toronto", "Toronto, ON"), fact("fact:montreal", "Montreal, QC")];
    const conflict = detectFactConflicts(facts)[0];
    if (!conflict) throw new Error("fixture did not create a conflict");
    const input = {
      conflictId: conflict.id,
      selectedFactId: "fact:toronto",
      reviewedConflictHash: conflict.reviewedConflictHash,
      decidedBy: "user:local",
      decidedAt,
    };

    expect(() => resolveFactConflict(facts, { ...input, reviewedConflictHash: "f".repeat(64) })).toThrow(
      ResumeImportError,
    );
    expect(() => resolveFactConflict(facts, { ...input, selectedFactId: "fact:unknown" })).toThrow(
      /not a candidate/,
    );
  });

  it("opens a new conflict when a later import disputes the resolved value", () => {
    const facts = [fact("fact:toronto", "Toronto, ON"), fact("fact:montreal", "Montreal, QC")];
    const conflict = detectFactConflicts(facts)[0];
    if (!conflict) throw new Error("fixture did not create a conflict");
    const resolved = resolveFactConflict(facts, {
      conflictId: conflict.id,
      selectedFactId: "fact:toronto",
      reviewedConflictHash: conflict.reviewedConflictHash,
      decidedBy: "user:local",
      decidedAt,
    });
    const later = fact("fact:vancouver", "Vancouver, BC", {
      createdAt: "2026-07-28T11:00:00-04:00",
      updatedAt: "2026-07-28T11:00:00-04:00",
    });
    const nextConflict = detectFactConflicts([...resolved.facts, later])[0];

    expect(nextConflict?.id).not.toBe(conflict.id);
    expect(nextConflict?.candidateFactIds).toEqual(["fact:toronto", "fact:vancouver"]);
  });
});
