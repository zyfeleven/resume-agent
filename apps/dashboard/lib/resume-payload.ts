import type {
  ClaimGuardReport,
  Fact,
  JDRequirement,
  Job,
  ResumeChange,
  ResumeChangeSet,
  ResumeIR,
  ResumeTailorReport,
} from "@resume-agent/contracts";
import { applyReviewedChanges, changeReviewHash } from "@resume-agent/resume-tailor";

import type { ResumeStore } from "./resume-store";

export interface ChangeView {
  change: ResumeChange;
  reviewHash: string;
  decision: "approved" | "rejected" | null;
  section: string;
  requirementTexts: string[];
  factValues: string[];
}

export interface CoverageView {
  requirementId: string;
  text: string;
  priority: JDRequirement["priority"];
  strength: "exact" | "related" | "missing";
  factValues: string[];
}

export interface TailoredResumeView {
  job: Pick<Job, "id" | "title" | "company">;
  changeSetId: string;
  generatedAt: string;
  model: string;
  guard: ClaimGuardReport | null;
  report: ResumeTailorReport | null;
  changes: ChangeView[];
  coverage: CoverageView[];
  pendingChangeIds: string[];
  resume: ResumeIR;
  keptItemCount: number;
  removedItemCount: number;
}

export interface ResumePayload {
  jobs: Array<Pick<Job, "id" | "title" | "company">>;
  verifiedFactCount: number;
  tailored: TailoredResumeView | null;
  /** Set when a resume cannot be built or tailored yet, with what to do about it. */
  blocked: { reason: string } | null;
}

function sectionOf(resume: ResumeIR, itemId: string): string {
  if (resume.summary.some((item) => item.id === itemId)) return "Summary";
  if (resume.skills.some((item) => item.id === itemId)) return "Skills";
  if (resume.projects.some((item) => item.id === itemId)) return "Projects";
  if (resume.education.some((item) => item.id === itemId)) return "Education";
  if (resume.experience.some((entry) => entry.bullets.some((item) => item.id === itemId))) return "Experience";
  return "Resume";
}

export function toTailoredView(input: {
  store: ResumeStore;
  changeSet: ResumeChangeSet;
  baseResume: ResumeIR;
  job: Job;
  facts: readonly Fact[];
  requirements: readonly JDRequirement[];
}): TailoredResumeView {
  const { store, changeSet, baseResume, job } = input;
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const requirementsById = new Map(input.requirements.map((requirement) => [requirement.id, requirement]));

  const reviews = store.reviews.filter((review) => review.changeSetId === changeSet.id);
  const decisionByChangeId = new Map(reviews.map((review) => [review.changeId, review.decision]));
  const applied = applyReviewedChanges(baseResume, changeSet, reviews);

  const matches = store.matchSets.find((entry) => entry.changeSetId === changeSet.id)?.matches ?? [];
  const report = store.reports.find((entry) => entry.changeSetId === changeSet.id) ?? null;

  return {
    job: { id: job.id, title: job.title, company: job.company },
    changeSetId: changeSet.id,
    generatedAt: changeSet.createdAt,
    model: changeSet.model,
    guard: store.guardReports.find((entry) => entry.changeSetId === changeSet.id) ?? null,
    report,
    changes: changeSet.changes.map((change) => ({
      change,
      reviewHash: changeReviewHash(change),
      decision: decisionByChangeId.get(change.id) ?? null,
      section: sectionOf(baseResume, change.targetItemId),
      requirementTexts: change.requirementIds
        .map((requirementId) => requirementsById.get(requirementId)?.text)
        .filter((text): text is string => Boolean(text)),
      factValues: change.factIds
        .map((factId) => factsById.get(factId))
        .filter((fact): fact is Fact => Boolean(fact))
        .map((fact) => String(fact.value)),
    })),
    coverage: matches.map((match) => ({
      requirementId: match.requirementId,
      text: requirementsById.get(match.requirementId)?.text ?? match.requirementId,
      priority: requirementsById.get(match.requirementId)?.priority ?? "context",
      strength: match.strength === "conflict" ? "missing" : match.strength,
      factValues: match.factIds
        .map((factId) => factsById.get(factId))
        .filter((fact): fact is Fact => Boolean(fact))
        .map((fact) => String(fact.value)),
    })),
    pendingChangeIds: applied.pendingChangeIds,
    resume: applied.resume,
    keptItemCount: applied.keptItemCount,
    removedItemCount: applied.removedItemCount,
  };
}
