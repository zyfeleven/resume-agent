import {
  ResumeChangeReviewSchema,
  ResumeChangeSetSchema,
  ResumeIRSchema,
  type ResumeChange,
  type ResumeChangeReview,
  type ResumeChangeSet,
  type ResumeIR,
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

export interface ReviewedResumeResult {
  resume: ResumeIR;
  contentHash: string;
  pendingChangeIds: string[];
  keptItemCount: number;
  removedItemCount: number;
}

/**
 * Digest of the exact change a reviewer saw. A decision carries it so a change set that
 * was regenerated between rendering and the click fails closed instead of inheriting an
 * approval meant for different wording.
 */
export function changeReviewHash(change: ResumeChange): string {
  return createHash("sha256").update(JSON.stringify(change)).digest("hex");
}

/** Record one decision about one proposed change. */
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

/**
 * Build the resume the reviewer is currently looking at.
 *
 * An approved change applies as proposed; a rejected one applies in reverse, so rejecting
 * a removal is how a reviewer keeps a line the generator wanted to drop. Changes nobody
 * has decided yet are shown as proposed and counted as pending, because a resume may not
 * be finalized while any proposed change is still unreviewed.
 */
export function applyReviewedChanges(
  baseResumeInput: unknown,
  changeSetInput: unknown,
  reviewsInput: readonly ResumeChangeReview[],
): ReviewedResumeResult {
  const baseResume = ResumeIRSchema.parse(baseResumeInput);
  const changeSet: ResumeChangeSet = ResumeChangeSetSchema.parse(changeSetInput);
  const reviews = reviewsInput.map((review) => ResumeChangeReviewSchema.parse(review));

  if (hashJson(baseResume) !== changeSet.baseContentHash) {
    throw new ResumeTailorError(
      "STALE_REVIEW",
      "The base resume changed after this change set was generated. Generate it again.",
    );
  }

  const itemsById = new Set(resumeItems(baseResume).map(({ item }) => item.id));
  for (const change of changeSet.changes) {
    if (!itemsById.has(change.targetItemId)) {
      throw new ResumeTailorError("CHANGE_NOT_FOUND", `Change ${change.id} targets an item outside this resume.`);
    }
  }

  const changesById = new Map(changeSet.changes.map((change) => [change.id, change]));
  for (const review of reviews.filter((entry) => entry.changeSetId === changeSet.id)) {
    const change = changesById.get(review.changeId);
    if (!change || changeReviewHash(change) !== review.reviewedChangeHash) {
      throw new ResumeTailorError("STALE_REVIEW", "A stored review no longer matches this change set.");
    }
  }

  const decisionByChangeId = new Map(
    reviews.filter((review) => review.changeSetId === changeSet.id).map((review) => [review.changeId, review.decision]),
  );

  const removedItemIds = new Set<string>();
  const requirementIdsByItem = new Map<string, string[]>();
  const pendingChangeIds: string[] = [];
  let keptItemCount = 0;

  for (const change of changeSet.changes) {
    const decision = decisionByChangeId.get(change.id);
    if (!decision) {
      pendingChangeIds.push(change.id);
    }

    const applyAsProposed = decision !== "rejected";
    const drops = change.intent === "remove" ? applyAsProposed : !applyAsProposed;

    if (drops) {
      removedItemIds.add(change.targetItemId);
      continue;
    }

    keptItemCount += 1;
    requirementIdsByItem.set(change.targetItemId, change.requirementIds);
  }

  const keepItems = (items: ResumeIR["summary"]) =>
    items
      .filter((item) => !removedItemIds.has(item.id))
      .map((item) => ({ ...item, requirementIds: requirementIdsByItem.get(item.id) ?? [] }));

  const resume = ResumeIRSchema.parse({
    ...baseResume,
    summary: keepItems(baseResume.summary),
    skills: keepItems(baseResume.skills),
    projects: keepItems(baseResume.projects),
    education: keepItems(baseResume.education),
    experience: baseResume.experience.map((entry) => ({ ...entry, bullets: keepItems(entry.bullets) })),
  });

  return {
    resume,
    contentHash: hashJson(resume),
    pendingChangeIds,
    keptItemCount,
    removedItemCount: removedItemIds.size,
  };
}
