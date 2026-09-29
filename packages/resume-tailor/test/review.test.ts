import type { ResumeChange, ResumeChangeReview } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import {
  ResumeTailorError,
  applyReviewedChanges,
  buildBaseResume,
  changeReviewHash,
  generateChangeSet,
  reviewChange,
  reviewSentenceChange,
  sentenceChanges,
  sentenceReviewHash,
  splitResumeSentences,
} from "../src/index.js";
import { GENERATED_AT, JOB_ID, PROFILE_ID, requirements, verifiedFacts } from "./fixture.js";

const DECIDED_AT = "2026-07-27T17:10:00-04:00";
const REVIEWER = "user:local";

function scenario() {
  const facts = verifiedFacts();
  const { resume } = buildBaseResume(PROFILE_ID, facts);
  const { changeSet } = generateChangeSet({
    jobId: JOB_ID,
    profileId: PROFILE_ID,
    baseResume: resume,
    baseResumeVersionId: "resume-version:base",
    requirements: requirements(),
    facts,
    generatedAt: GENERATED_AT,
  });
  return { baseResume: resume, changeSet };
}

function decide(change: ResumeChange, decision: "approved" | "rejected") {
  return {
    changeId: change.id,
    decision,
    reviewedChangeHash: changeReviewHash(change),
    decidedBy: REVIEWER,
    decidedAt: DECIDED_AT,
  };
}

function changeWith(changes: readonly ResumeChange[], text: string): ResumeChange {
  const match = changes.find((change) =>
    (Array.isArray(change.before) ? change.before.join(" ") : change.before).includes(text),
  );
  if (!match) {
    throw new Error(`fixture has no change for ${text}`);
  }
  return match;
}

describe("reviewChange", () => {
  it("records a decision bound to the change the reviewer saw", () => {
    const { changeSet } = scenario();
    const change = changeWith(changeSet.changes, "Figma");

    const review = reviewChange(changeSet, decide(change, "approved"));

    expect(review.changeSetId).toBe(changeSet.id);
    expect(review.changeId).toBe(change.id);
    expect(review.decision).toBe("approved");
    expect(review.decidedBy).toBe(REVIEWER);
  });

  it("refuses a decision made against different wording", () => {
    const { changeSet } = scenario();
    const change = changeWith(changeSet.changes, "Figma");

    expect(() => reviewChange(changeSet, { ...decide(change, "approved"), reviewedChangeHash: "f".repeat(64) })).toThrow(
      ResumeTailorError,
    );
    expect(() => reviewChange(changeSet, { ...decide(change, "approved"), reviewedChangeHash: "f".repeat(64) })).toThrow(
      /regenerated/i,
    );
  });

  it("refuses a decision for a change that is not in the set", () => {
    const { changeSet } = scenario();
    const change = changeWith(changeSet.changes, "Figma");

    expect(() => reviewChange(changeSet, { ...decide(change, "approved"), changeId: "change:missing" })).toThrow(
      /not in this change set/i,
    );
  });
});

describe("sentence review", () => {
  it("projects stable sentence decisions without rewriting their punctuation", () => {
    const { changeSet } = scenario();
    const change = changeWith(changeSet.changes, "Figma");
    const first = sentenceChanges(change);
    const second = sentenceChanges(change);

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]?.proposedText).toBe(change.intent === "keep" ? change.before : null);
    expect(sentenceReviewHash(first[0]!)).toMatch(/^[a-f0-9]{64}$/);
    expect(splitResumeSentences("Built APIs. Reduced latency! Shipped safely?")).toEqual([
      "Built APIs.",
      "Reduced latency!",
      "Shipped safely?",
    ]);
  });

  it("records a decision against the exact sentence snapshot and rejects stale hashes", () => {
    const { changeSet } = scenario();
    const change = changeWith(changeSet.changes, "Figma");
    const sentence = sentenceChanges(change)[0];
    if (!sentence) throw new Error("fixture has no sentence change");
    const decision = {
      changeId: change.id,
      sentenceId: sentence.id,
      decision: "approved" as const,
      reviewedSentenceHash: sentenceReviewHash(sentence),
      decidedBy: REVIEWER,
      decidedAt: DECIDED_AT,
    };

    expect(reviewSentenceChange(changeSet, decision)).toMatchObject({
      changeId: change.id,
      sentenceId: sentence.id,
      decision: "approved",
    });
    expect(() => reviewSentenceChange(changeSet, { ...decision, reviewedSentenceHash: "f".repeat(64) })).toThrow(
      /sentence changed/i,
    );
  });

  it("applies rewrite sentences independently and keeps approval blocked until all are decided", () => {
    const { baseResume, changeSet } = scenario();
    const original = changeWith(changeSet.changes, "Figma");
    if (original.intent !== "keep") throw new Error("fixture Figma change is not keep");
    const rewrite = {
      ...original,
      intent: "rewrite" as const,
      before: original.before,
      after: "Figma. Advanced prototyping.",
    };
    const rewrittenSet = { ...changeSet, changes: changeSet.changes.map((change) => (change.id === original.id ? rewrite : change)) };
    const sentences = sentenceChanges(rewrite);
    const sentenceReviews = sentences.map((sentence, index) =>
      reviewSentenceChange(rewrittenSet, {
        changeId: rewrite.id,
        sentenceId: sentence.id,
        decision: index === 0 ? "approved" : "rejected",
        reviewedSentenceHash: sentenceReviewHash(sentence),
        decidedBy: REVIEWER,
        decidedAt: DECIDED_AT,
      }),
    );
    const result = applyReviewedChanges(baseResume, rewrittenSet, [], sentenceReviews);

    expect(result.resume.skills.map((item) => item.text)).toContain("Figma.");
    expect(result.resume.skills.map((item) => item.text)).not.toContain("Figma. Advanced prototyping.");
    expect(result.pendingChangeIds).not.toContain(sentences[0]?.id);
    expect(result.pendingChangeIds).not.toContain(sentences[1]?.id);
    expect(result.pendingChangeIds.length).toBeGreaterThan(0);
  });
});

describe("applyReviewedChanges", () => {
  it("shows the proposal while changes are still unreviewed", () => {
    const { baseResume, changeSet } = scenario();

    const result = applyReviewedChanges(baseResume, changeSet, []);

    expect(result.pendingChangeIds).toHaveLength(changeSet.changes.length);
    expect(result.resume.skills.map((item) => item.text)).toContain("Figma");
    expect(result.resume.skills.map((item) => item.text)).not.toContain("Woodworking");
  });

  it("keeps a line when the reviewer rejects its removal", () => {
    const { baseResume, changeSet } = scenario();
    const removal = changeWith(changeSet.changes, "Woodworking");
    const reviews: ResumeChangeReview[] = [reviewChange(changeSet, decide(removal, "rejected"))];

    const result = applyReviewedChanges(baseResume, changeSet, reviews);

    expect(result.resume.skills.map((item) => item.text)).toContain("Woodworking");
    expect(result.pendingChangeIds).not.toContain(removal.id);
  });

  it("drops a line when the reviewer rejects keeping it", () => {
    const { baseResume, changeSet } = scenario();
    const keep = changeWith(changeSet.changes, "Figma");
    const reviews: ResumeChangeReview[] = [reviewChange(changeSet, decide(keep, "rejected"))];

    const result = applyReviewedChanges(baseResume, changeSet, reviews);

    expect(result.resume.skills.map((item) => item.text)).not.toContain("Figma");
  });

  it("reports nothing pending once every change is decided", () => {
    const { baseResume, changeSet } = scenario();
    const reviews = changeSet.changes.map((change) => reviewChange(changeSet, decide(change, "approved")));

    const result = applyReviewedChanges(baseResume, changeSet, reviews);

    expect(result.pendingChangeIds).toEqual([]);
    expect(result.keptItemCount + result.removedItemCount).toBe(changeSet.changes.length);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("ignores reviews that belong to another change set", () => {
    const { baseResume, changeSet } = scenario();
    const removal = changeWith(changeSet.changes, "Woodworking");
    const foreign: ResumeChangeReview = {
      ...reviewChange(changeSet, decide(removal, "rejected")),
      changeSetId: "change-set:another",
    };

    const result = applyReviewedChanges(baseResume, changeSet, [foreign]);

    expect(result.resume.skills.map((item) => item.text)).not.toContain("Woodworking");
    expect(result.pendingChangeIds).toContain(sentenceChanges(removal)[0]?.id);
  });
});
