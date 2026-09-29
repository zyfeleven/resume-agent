import type {
  ClaimGuardReport,
  Fact,
  JDRequirement,
  Job,
  ResumeChange,
  ResumeChangeSet,
  ResumeIR,
  ResumeTailorReport,
  SourceLocator,
  RequirementFactMatch,
  ResumeSentenceChange,
} from "@resume-agent/contracts";
import {
  applyReviewedChanges,
  changeReviewHash,
  sentenceChanges,
  sentenceReviewHash,
} from "@resume-agent/resume-tailor";

import type { ResumeStore } from "./resume-store";

export interface ChangeView {
  change: ResumeChange;
  reviewHash: string;
  decision: "approved" | "rejected" | null;
  section: string;
  requirementTexts: string[];
  factValues: string[];
  sentences: SentenceChangeView[];
}

export interface SentenceChangeView {
  sentence: ResumeSentenceChange;
  reviewHash: string;
  decision: "approved" | "rejected" | null;
}

export interface MatchSourceView extends SourceLocator {
  fileName: string;
}

export interface MatchFactView {
  factId: string;
  key: string;
  kind: Fact["kind"];
  value: string;
  basis: "keyword" | "term_overlap" | "term_and_duration" | "semantic_model" | null;
  terms: string[];
  sources: MatchSourceView[];
}

export interface CoverageView {
  requirementId: string;
  text: string;
  priority: JDRequirement["priority"];
  kind: JDRequirement["kind"];
  keywords: string[];
  source: MatchSourceView;
  strength: "exact" | "related" | "missing" | "conflict";
  rationale: string;
  confidence: number;
  facts: MatchFactView[];
}

export interface TailoredResumeView {
  job: Pick<Job, "id" | "title" | "company">;
  changeSetId: string;
  generatedAt: string;
  model: string;
  guard: ClaimGuardReport | null;
  semanticGuard: ClaimGuardReport | null;
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

export function toMatchMatrix(input: {
  matches: readonly RequirementFactMatch[];
  facts: readonly Fact[];
  allFacts?: readonly Fact[];
  blockedFactIds?: readonly string[];
  requirements: readonly JDRequirement[];
  descriptionArtifactId: string;
  sourceFileNames?: Readonly<Record<string, string>>;
}): CoverageView[] {
  const allFactsById = new Map((input.allFacts ?? input.facts).map((fact) => [fact.id, fact]));
  const requirementsById = new Map(input.requirements.map((requirement) => [requirement.id, requirement]));
  const usableFactIds = new Set(input.facts.filter((fact) => fact.status === "verified").map((fact) => fact.id));
  const blockedFactIds = new Set(input.blockedFactIds ?? []);
  const sourceView = (source: SourceLocator): MatchSourceView => ({
    artifactId: source.artifactId,
    fileName: input.sourceFileNames?.[source.artifactId] ?? source.artifactId,
    locator: source.locator,
    ...(source.excerpt === undefined ? {} : { excerpt: source.excerpt }),
  });

  return input.matches.map((storedMatch) => {
    const usableIds = storedMatch.factIds.filter(
      (factId) => usableFactIds.has(factId) && !blockedFactIds.has(factId),
    );
    const disputedIds = storedMatch.factIds.filter((factId) => blockedFactIds.has(factId));
    const match =
      usableIds.length > 0
        ? {
            ...storedMatch,
            factIds: usableIds,
            evidence: storedMatch.evidence.filter((entry) => usableIds.includes(entry.factId)),
            rationale:
              usableIds.length === storedMatch.factIds.length
                ? storedMatch.rationale
                : `${storedMatch.rationale} Disputed candidates were excluded from this match.`,
          }
        : disputedIds.length > 0
          ? {
              ...storedMatch,
              factIds: disputedIds,
              strength: "conflict" as const,
              confidence: 0,
              rationale: "Matching facts have unresolved source conflicts and do not count as support.",
              evidence: storedMatch.evidence.filter((entry) => disputedIds.includes(entry.factId)),
            }
          : {
              ...storedMatch,
              factIds: [],
              strength: "missing" as const,
              confidence: 0,
              rationale: "No currently verified, conflict-free fact supports this requirement.",
              evidence: [],
            };
    const requirement = requirementsById.get(match.requirementId);

    return {
      requirementId: match.requirementId,
      text: requirement?.text ?? match.requirementId,
      priority: requirement?.priority ?? "context",
      kind: requirement?.kind ?? "other",
      keywords: requirement?.keywords ?? [],
      source: sourceView(
        requirement?.source ?? { artifactId: input.descriptionArtifactId, locator: "job description" },
      ),
      strength: match.strength,
      rationale: match.rationale,
      confidence: match.confidence,
      facts: match.factIds
        .map((factId) => {
          const fact = allFactsById.get(factId);
          if (!fact) return null;
          const evidence = match.evidence.find((entry) => entry.factId === fact.id);
          return {
            factId: fact.id,
            key: fact.key,
            kind: fact.kind,
            value: typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value),
            basis: evidence?.basis ?? null,
            terms: evidence?.terms ?? [],
            sources: fact.sources.map(sourceView),
          };
        })
        .filter((fact): fact is MatchFactView => fact !== null),
    };
  });
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
  allFacts?: readonly Fact[];
  blockedFactIds?: readonly string[];
  sourceFileNames?: Readonly<Record<string, string>>;
  requirements: readonly JDRequirement[];
}): TailoredResumeView {
  const { store, changeSet, baseResume, job } = input;
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const requirementsById = new Map(input.requirements.map((requirement) => [requirement.id, requirement]));

  const reviews = store.reviews.filter((review) => review.changeSetId === changeSet.id);
  const decisionByChangeId = new Map(reviews.map((review) => [review.changeId, review.decision]));
  const sentenceReviews = store.sentenceReviews.filter((review) => review.changeSetId === changeSet.id);
  const decisionBySentenceId = new Map(sentenceReviews.map((review) => [review.sentenceId, review.decision]));
  const applied = applyReviewedChanges(baseResume, changeSet, reviews, sentenceReviews);

  const matches = store.matchSets.find((entry) => entry.changeSetId === changeSet.id)?.matches ?? [];
  const report = store.reports.find((entry) => entry.changeSetId === changeSet.id) ?? null;

  return {
    job: { id: job.id, title: job.title, company: job.company },
    changeSetId: changeSet.id,
    generatedAt: changeSet.createdAt,
    model: changeSet.model,
    guard: store.guardReports.find((entry) => entry.changeSetId === changeSet.id) ?? null,
    semanticGuard: store.semanticGuardReports.find((entry) => entry.changeSetId === changeSet.id) ?? null,
    report,
    changes: changeSet.changes.map((change) => {
      const legacyDecision = decisionByChangeId.get(change.id) ?? null;
      return {
        change,
        reviewHash: changeReviewHash(change),
        decision: legacyDecision,
        sentences: sentenceChanges(change).map((sentence) => ({
          sentence,
          reviewHash: sentenceReviewHash(sentence),
          decision: legacyDecision ?? decisionBySentenceId.get(sentence.id) ?? null,
        })),
        section: sectionOf(baseResume, change.targetItemId),
        requirementTexts: change.requirementIds
          .map((requirementId) => requirementsById.get(requirementId)?.text)
          .filter((text): text is string => Boolean(text)),
        factValues: change.factIds
          .map((factId) => factsById.get(factId))
          .filter((fact): fact is Fact => Boolean(fact))
          .map((fact) => String(fact.value)),
      };
    }),
    coverage: toMatchMatrix({
      matches,
      facts: input.facts,
      ...(input.allFacts === undefined ? {} : { allFacts: input.allFacts }),
      ...(input.blockedFactIds === undefined ? {} : { blockedFactIds: input.blockedFactIds }),
      requirements: input.requirements,
      descriptionArtifactId: job.descriptionArtifactId,
      ...(input.sourceFileNames === undefined ? {} : { sourceFileNames: input.sourceFileNames }),
    }),
    pendingChangeIds: applied.pendingChangeIds,
    resume: applied.resume,
    keptItemCount: applied.keptItemCount,
    removedItemCount: applied.removedItemCount,
  };
}
