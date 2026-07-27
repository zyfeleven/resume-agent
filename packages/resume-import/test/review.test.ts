import type { Fact } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import {
  ResumeImportError,
  extractResumeFacts,
  factReviewHash,
  mergeImportedFacts,
  reviewFact,
  summarizeFactReview,
} from "../src/index.js";

const importedAt = "2026-07-27T16:00:00-04:00";
const decidedAt = "2026-07-27T16:05:00-04:00";

const resumeText = `Maya Chen
maya.chen@example.com | Toronto, ON

EXPERIENCE
Senior Product Designer — Northstar Labs
Jan 2021 – Present
- Built a shared component library adopted by six product teams.
`;

function importFacts(overrides: Record<string, unknown> = {}): Fact[] {
  return extractResumeFacts({
    profileId: "profile:local",
    source: {
      artifactId: "artifact:aaa111",
      fileName: "master-resume.docx",
      format: "docx",
      contentHash: "a".repeat(64),
      byteSize: 24_576,
    },
    text: resumeText,
    importedAt,
    ...overrides,
  }).facts;
}

function pendingFact(): Fact {
  const fact = importFacts()[0];
  if (!fact) {
    throw new Error("fixture produced no facts");
  }
  return fact;
}

function verification(fact: Fact) {
  return {
    decision: "verify" as const,
    factId: fact.id,
    reviewedValueHash: factReviewHash(fact),
    verifiedBy: "user" as const,
    decidedAt,
  };
}

function rejection(fact: Fact) {
  return {
    decision: "reject" as const,
    factId: fact.id,
    reviewedValueHash: factReviewHash(fact),
    rejectedBy: "user:local",
    reason: "This is an old address.",
    decidedAt,
  };
}

describe("reviewFact", () => {
  it("verifies a pending fact and records the decision", () => {
    const fact = pendingFact();
    const reviewed = reviewFact(fact, verification(fact));

    expect(reviewed.status).toBe("verified");
    expect(reviewed.version).toBe(fact.version + 1);
    expect(reviewed.updatedAt).toBe(decidedAt);
    expect(reviewed.status === "verified" && reviewed.verification).toEqual({
      verifiedBy: "user",
      verifiedAt: decidedAt,
    });
  });

  it("rejects a pending fact with a reason", () => {
    const fact = pendingFact();
    const reviewed = reviewFact(fact, rejection(fact));

    expect(reviewed.status).toBe("rejected");
    expect(reviewed.status === "rejected" && reviewed.rejection.reason).toBe("This is an old address.");
  });

  it("refuses a decision made against a stale value", () => {
    const fact = pendingFact();
    const staleDecision = { ...verification(fact), reviewedValueHash: "f".repeat(64) };

    expect(() => reviewFact(fact, staleDecision)).toThrow(ResumeImportError);
    expect(() => reviewFact(fact, staleDecision)).toThrow(/no longer matches/);
  });

  it("refuses a decision that targets another fact", () => {
    const [first, second] = importFacts();
    if (!first || !second) {
      throw new Error("fixture produced too few facts");
    }

    expect(() => reviewFact(first, verification(second))).toThrow(ResumeImportError);
  });

  it("replays an identical decision without changing the fact", () => {
    const fact = pendingFact();
    const reviewed = reviewFact(fact, verification(fact));

    expect(reviewFact(reviewed, verification(fact))).toEqual(reviewed);
  });

  it("refuses to overturn a decision that was already made", () => {
    const fact = pendingFact();
    const verified = reviewFact(fact, verification(fact));

    expect(() => reviewFact(verified, { ...rejection(fact), decidedAt: "2026-07-27T16:10:00-04:00" })).toThrow(
      /already verified/,
    );
  });

  it("refuses a decision timestamped before the fact was last updated", () => {
    const fact = pendingFact();
    const backdated = { ...verification(fact), decidedAt: "2026-07-27T15:00:00-04:00" };

    expect(() => reviewFact(fact, backdated)).toThrow(/backwards/);
  });

  it("summarizes review progress", () => {
    const facts = importFacts();
    const first = facts[0];
    const second = facts[1];
    if (!first || !second) {
      throw new Error("fixture produced too few facts");
    }

    const reviewed = [reviewFact(first, verification(first)), reviewFact(second, rejection(second)), ...facts.slice(2)];
    expect(summarizeFactReview(reviewed)).toEqual({
      pending: facts.length - 2,
      verified: 1,
      rejected: 1,
    });
  });
});

describe("mergeImportedFacts", () => {
  it("keeps an existing decision and adds the new source when a resume is re-imported", () => {
    const original = importFacts();
    const first = original[0];
    if (!first) {
      throw new Error("fixture produced no facts");
    }

    const verified = reviewFact(first, verification(first));
    const stored = [verified, ...original.slice(1)];

    const reimported = importFacts({
      source: {
        artifactId: "artifact:bbb222",
        fileName: "master-resume-v2.docx",
        format: "docx",
        contentHash: "b".repeat(64),
        byteSize: 25_000,
      },
      importedAt: "2026-08-01T09:00:00-04:00",
    });

    const merged = mergeImportedFacts(stored, reimported);
    const mergedFact = merged.facts.find((fact) => fact.id === verified.id);

    expect(merged.addedFactIds).toEqual([]);
    expect(merged.updatedFactIds).toContain(verified.id);
    expect(mergedFact?.status).toBe("verified");
    expect(mergedFact?.version).toBe(verified.version);
    expect(mergedFact?.sources.map((source) => source.artifactId)).toEqual(["artifact:aaa111", "artifact:bbb222"]);
  });

  it("adds facts that only the new document contains and keeps the rest", () => {
    const original = importFacts();
    const extended = importFacts({ text: `${resumeText}\nSKILLS\nFigma, Accessibility\n` });

    const merged = mergeImportedFacts(original, extended);
    const addedValues = merged.facts
      .filter((fact) => merged.addedFactIds.includes(fact.id))
      .map((fact) => fact.value);

    expect(addedValues).toContain("Figma");
    expect(merged.facts.length).toBe(original.length + merged.addedFactIds.length);
    expect(merged.unchangedFactIds.length).toBeGreaterThan(0);
  });

  it("does not drop a stored fact that the new document no longer contains", () => {
    const original = importFacts();
    const shorter = importFacts({ text: "Maya Chen\nmaya.chen@example.com | Toronto, ON\n" });

    const merged = mergeImportedFacts(original, shorter);
    expect(merged.facts.length).toBe(original.length);
  });
});
