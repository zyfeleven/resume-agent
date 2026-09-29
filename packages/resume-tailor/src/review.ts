import {
  ResumeChangeReviewSchema,
  ResumeChangeSchema,
  ResumeChangeSetSchema,
  ResumeIRSchema,
  ResumeSentenceChangeSchema,
  ResumeSentenceReviewSchema,
  type ResumeChange,
  type ResumeChangeReview,
  type ResumeChangeSet,
  type ResumeIR,
  type ResumeSentenceChange,
  type ResumeSentenceReview,
} from "@resume-agent/contracts";
import { createHash } from "node:crypto";

import { hashJson, resumeItems, stableId } from "./base.js";
import { ResumeTailorError } from "./errors.js";

export interface ChangeReviewDecision {
  changeId: string;
  decision: "approved" | "rejected";
  reviewedChangeHash: string;
  decidedBy: string;
  decidedAt: string;
}

export interface SentenceReviewDecision {
  changeId: string;
  sentenceId: string;
  decision: "approved" | "rejected";
  reviewedSentenceHash: string;
  decidedBy: string;
  decidedAt: string;
}

export interface ReviewedResumeResult {
  resume: ResumeIR;
  contentHash: string;
  /** Sentence IDs for sentence review; change IDs only for legacy item-level review records. */
  pendingChangeIds: string[];
  keptItemCount: number;
  removedItemCount: number;
}

export function changeReviewHash(change: ResumeChange): string {
  return createHash("sha256").update(JSON.stringify(change)).digest("hex");
}

export function reviewChange(changeSetInput: unknown, decision: ChangeReviewDecision): ResumeChangeReview {
  const changeSet = ResumeChangeSetSchema.parse(changeSetInput);
  const change = changeSet.changes.find((candidate) => candidate.id === decision.changeId);
  if (!change) {
    throw new ResumeTailorError("CHANGE_NOT_FOUND", `Change ${decision.changeId} is not in this change set.`);
  }
  if (changeReviewHash(change) !== decision.reviewedChangeHash) {
    throw new ResumeTailorError("STALE_REVIEW", "This change was regenerated after it was displayed. Reload and review it again.");
  }

  return ResumeChangeReviewSchema.parse({
    id: stableId("change-review", [changeSet.id, change.id]),
    changeSetId: changeSet.id,
    changeId: change.id,
    reviewedChangeHash: decision.reviewedChangeHash,
    decision: decision.decision,
    decidedBy: decision.decidedBy,
    decidedAt: decision.decidedAt,
  });
}

/** Split review text without rewriting it; punctuation stays attached to its sentence. */
export function splitResumeSentences(text: string): string[] {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return [];
  return (normalized.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [normalized])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function changeSides(change: ResumeChange): { proposed: string[]; fallback: string[] } {
  if (change.intent === "keep") return { proposed: splitResumeSentences(change.before), fallback: [] };
  if (change.intent === "remove") return { proposed: [], fallback: splitResumeSentences(change.before) };
  const fallbackText = Array.isArray(change.before) ? change.before.join(" ") : change.before;
  return { proposed: splitResumeSentences(change.after), fallback: splitResumeSentences(fallbackText) };
}

/** Stable sentence-sized decisions projected from one change. */
export function sentenceChanges(changeInput: unknown): ResumeSentenceChange[] {
  const change = ResumeChangeSchema.parse(changeInput);
  const { proposed, fallback } = changeSides(change);
  return Array.from({ length: Math.max(proposed.length, fallback.length) }, (_, ordinal) => {
    const proposedText = proposed[ordinal] ?? null;
    const fallbackText = fallback[ordinal] ?? null;
    return ResumeSentenceChangeSchema.parse({
      id: stableId("sentence-change", [change.id, String(ordinal), proposedText ?? "", fallbackText ?? ""]),
      changeId: change.id,
      ordinal,
      proposedText,
      fallbackText,
      factIds: change.factIds,
      requirementIds: change.requirementIds,
      rationale: change.rationale,
    });
  });
}

export function sentenceReviewHash(sentence: ResumeSentenceChange): string {
  return createHash("sha256").update(JSON.stringify(sentence)).digest("hex");
}

export function reviewSentenceChange(changeSetInput: unknown, decision: SentenceReviewDecision): ResumeSentenceReview {
  const changeSet = ResumeChangeSetSchema.parse(changeSetInput);
  const change = changeSet.changes.find((candidate) => candidate.id === decision.changeId);
  if (!change) {
    throw new ResumeTailorError("CHANGE_NOT_FOUND", `Change ${decision.changeId} is not in this change set.`);
  }
  const sentence = sentenceChanges(change).find((candidate) => candidate.id === decision.sentenceId);
  if (!sentence) {
    throw new ResumeTailorError("CHANGE_NOT_FOUND", `Sentence ${decision.sentenceId} is not in change ${change.id}.`);
  }
  if (sentenceReviewHash(sentence) !== decision.reviewedSentenceHash) {
    throw new ResumeTailorError("STALE_REVIEW", "This sentence changed after it was displayed. Reload and review it again.");
  }

  return ResumeSentenceReviewSchema.parse({
    id: stableId("sentence-review", [changeSet.id, change.id, sentence.id]),
    changeSetId: changeSet.id,
    changeId: change.id,
    sentenceId: sentence.id,
    reviewedSentenceHash: decision.reviewedSentenceHash,
    decision: decision.decision,
    decidedBy: decision.decidedBy,
    decidedAt: decision.decidedAt,
  });
}

/** Apply legacy item reviews or the finer sentence decisions; undecided sentences preview the proposal. */
export function applyReviewedChanges(
  baseResumeInput: unknown,
  changeSetInput: unknown,
  reviewsInput: readonly ResumeChangeReview[],
  sentenceReviewsInput: readonly ResumeSentenceReview[] = [],
): ReviewedResumeResult {
  const baseResume = ResumeIRSchema.parse(baseResumeInput);
  const changeSet: ResumeChangeSet = ResumeChangeSetSchema.parse(changeSetInput);
  const reviews = reviewsInput.map((review) => ResumeChangeReviewSchema.parse(review));
  const sentenceReviews = sentenceReviewsInput.map((review) => ResumeSentenceReviewSchema.parse(review));

  if (hashJson(baseResume) !== changeSet.baseContentHash) {
    throw new ResumeTailorError("STALE_REVIEW", "The base resume changed after this change set was generated. Generate it again.");
  }

  const baseItems = resumeItems(baseResume);
  const itemsById = new Set(baseItems.map(({ item }) => item.id));
  const changesById = new Map(changeSet.changes.map((change) => [change.id, change]));
  for (const change of changeSet.changes) {
    if (!itemsById.has(change.targetItemId)) {
      throw new ResumeTailorError("CHANGE_NOT_FOUND", `Change ${change.id} targets an item outside this resume.`);
    }
  }

  for (const review of reviews.filter((entry) => entry.changeSetId === changeSet.id)) {
    const change = changesById.get(review.changeId);
    if (!change || changeReviewHash(change) !== review.reviewedChangeHash) {
      throw new ResumeTailorError("STALE_REVIEW", "A stored review no longer matches this change set.");
    }
  }
  const sentencesById = new Map(
    changeSet.changes.flatMap((change) => sentenceChanges(change)).map((sentence) => [sentence.id, sentence]),
  );
  for (const review of sentenceReviews.filter((entry) => entry.changeSetId === changeSet.id)) {
    const sentence = sentencesById.get(review.sentenceId);
    if (
      !sentence ||
      sentence.changeId !== review.changeId ||
      sentenceReviewHash(sentence) !== review.reviewedSentenceHash
    ) {
      throw new ResumeTailorError("STALE_REVIEW", "A stored sentence review no longer matches this change set.");
    }
  }

  const decisionByChangeId = new Map(
    reviews.filter((review) => review.changeSetId === changeSet.id).map((review) => [review.changeId, review.decision]),
  );
  const decisionBySentenceId = new Map(
    sentenceReviews
      .filter((review) => review.changeSetId === changeSet.id)
      .map((review) => [review.sentenceId, review.decision]),
  );
  const removedItemIds = new Set<string>();
  const textByItem = new Map<string, string>();
  const requirementIdsByItem = new Map<string, string[]>();
  const pendingChangeIds: string[] = [];

  for (const change of changeSet.changes) {
    const legacyDecision = decisionByChangeId.get(change.id);
    const chosen = sentenceChanges(change).flatMap((sentence) => {
      const decision = legacyDecision ?? decisionBySentenceId.get(sentence.id);
      if (!decision) pendingChangeIds.push(sentence.id);
      const text = decision === "rejected" ? sentence.fallbackText : sentence.proposedText;
      return text ? [text] : [];
    });
    const text = chosen.join(" ").trim();
    if (text.length === 0) {
      removedItemIds.add(change.targetItemId);
    } else {
      textByItem.set(change.targetItemId, text);
      requirementIdsByItem.set(change.targetItemId, change.requirementIds);
    }
    if (change.intent === "combine") {
      for (const sourceItemId of change.sourceItemIds) {
        if (sourceItemId !== change.targetItemId) removedItemIds.add(sourceItemId);
      }
    }
  }

  const keepItems = (items: ResumeIR["summary"]) =>
    items
      .filter((item) => !removedItemIds.has(item.id))
      .map((item) => ({
        ...item,
        text: textByItem.get(item.id) ?? item.text,
        requirementIds: requirementIdsByItem.get(item.id) ?? [],
      }));
  const resume = ResumeIRSchema.parse({
    ...baseResume,
    summary: keepItems(baseResume.summary),
    skills: keepItems(baseResume.skills),
    projects: keepItems(baseResume.projects),
    education: keepItems(baseResume.education),
    experience: baseResume.experience.map((entry) => ({ ...entry, bullets: keepItems(entry.bullets) })),
  });
  const keptItemCount = resumeItems(resume).length;

  return {
    resume,
    contentHash: hashJson(resume),
    pendingChangeIds,
    keptItemCount,
    removedItemCount: baseItems.length - keptItemCount,
  };
}
