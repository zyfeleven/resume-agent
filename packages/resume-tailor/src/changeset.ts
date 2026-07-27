import {
  ResumeChangeSetSchema,
  ResumeIRSchema,
  ResumeTailorReportSchema,
  type Fact,
  type JDRequirement,
  type RequirementFactMatch,
  type ResumeChange,
  type ResumeChangeSet,
  type ResumeIR,
  type ResumeTailorReport,
} from "@resume-agent/contracts";

import { factSnapshotHash, hashJson, resumeItems, stableId } from "./base.js";
import { matchRequirements } from "./match.js";

export const GENERATOR_VERSION = "resume-change-set-v1";

/**
 * Phase 1 tailoring selects; it does not write. Every change keeps or removes an item
 * whose text already came from a verified fact, so the model and prompt fields record
 * that no model produced this content.
 */
export const GENERATOR_MODEL = "deterministic-selector";
export const GENERATOR_PROMPT_VERSION = "no-prompt";

export interface GenerateChangeSetInput {
  jobId: string;
  profileId: string;
  baseResume: ResumeIR;
  baseResumeVersionId: string;
  requirements: readonly JDRequirement[];
  facts: readonly Fact[];
  generatedAt: string;
}

export interface GenerateChangeSetResult {
  changeSet: ResumeChangeSet;
  tailoredResume: ResumeIR;
  matches: RequirementFactMatch[];
  report: ResumeTailorReport;
}

function requirementSnapshot(requirements: readonly JDRequirement[]): string {
  return hashJson(
    [...requirements]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((requirement) => [requirement.id, requirement.priority, requirement.text]),
  );
}

/**
 * Produce the change set that tailors the base resume to one job.
 *
 * An item is kept when a verified fact behind it supports a requirement of this job, and
 * removed otherwise. Both intents cite the facts they rest on and the requirements they
 * answer, so a reviewer reads why each line survived rather than trusting a score.
 */
export function generateChangeSet(input: GenerateChangeSetInput): GenerateChangeSetResult {
  const verifiedFacts = input.facts.filter((fact) => fact.status === "verified");
  const matches = matchRequirements(input.requirements, verifiedFacts);
  const requirementById = new Map(input.requirements.map((requirement) => [requirement.id, requirement]));

  // Which requirements does each verified fact support?
  const requirementsByFact = new Map<string, string[]>();
  for (const match of matches) {
    if (match.strength === "missing") {
      continue;
    }
    for (const factId of match.factIds) {
      requirementsByFact.set(factId, [...(requirementsByFact.get(factId) ?? []), match.requirementId]);
    }
  }

  const changes: ResumeChange[] = [];
  const keptRequirementIdsByItem = new Map<string, string[]>();

  for (const { item, section } of resumeItems(input.baseResume)) {
    const supported = [...new Set(item.factIds.flatMap((factId) => requirementsByFact.get(factId) ?? []))];
    const changeId = stableId("change", [input.jobId, item.id]);

    if (supported.length > 0) {
      keptRequirementIdsByItem.set(item.id, supported);
      const cited = supported
        .map((requirementId) => requirementById.get(requirementId))
        .filter((requirement): requirement is JDRequirement => Boolean(requirement));

      changes.push({
        id: changeId,
        intent: "keep",
        targetItemId: item.id,
        factIds: item.factIds,
        requirementIds: supported,
        rationale: `Kept in ${section}: a verified fact behind this line supports ${cited.length} requirement(s), including "${
          cited[0]?.text.slice(0, 120) ?? ""
        }".`,
        before: item.text,
      });
      continue;
    }

    changes.push({
      id: changeId,
      intent: "remove",
      targetItemId: item.id,
      factIds: item.factIds,
      requirementIds: [],
      rationale: `Removed from ${section}: no requirement in this posting matches the verified fact behind this line.`,
      before: item.text,
      after: null,
    });
  }

  const removedItemIds = new Set(
    changes.filter((change) => change.intent === "remove").map((change) => change.targetItemId),
  );
  const tailoredResume = applySelection(input.baseResume, removedItemIds, keptRequirementIdsByItem);

  const baseContentHash = hashJson(input.baseResume);
  const resultContentHash = hashJson(tailoredResume);
  const factSnapshot = factSnapshotHash(input.facts);
  const requirementSnapshotHash = requirementSnapshot(input.requirements);
  const changeSetId = stableId("change-set", [input.jobId, baseContentHash, resultContentHash]);

  const changeSet = ResumeChangeSetSchema.parse({
    id: changeSetId,
    jobId: input.jobId,
    baseResumeVersionId: input.baseResumeVersionId,
    baseContentHash,
    resultContentHash,
    factSnapshotHash: factSnapshot,
    requirementSnapshotHash,
    changes,
    promptVersion: GENERATOR_PROMPT_VERSION,
    model: GENERATOR_MODEL,
    contentHash: hashJson([changeSetId, baseContentHash, resultContentHash, factSnapshot, changes]),
    createdAt: input.generatedAt,
    updatedAt: input.generatedAt,
  });

  const report = ResumeTailorReportSchema.parse({
    id: stableId("tailor-report", [changeSetId, input.generatedAt]),
    jobId: input.jobId,
    profileId: input.profileId,
    changeSetId,
    baseResumeVersionId: input.baseResumeVersionId,
    generatorVersion: GENERATOR_VERSION,
    generatedAt: input.generatedAt,
    verifiedFactCount: verifiedFacts.length,
    keptItemCount: changes.filter((change) => change.intent === "keep").length,
    removedItemCount: changes.filter((change) => change.intent === "remove").length,
    coverage: matches.map((match) => ({
      requirementId: match.requirementId,
      priority: requirementById.get(match.requirementId)?.priority ?? "context",
      strength: match.strength === "conflict" ? "missing" : match.strength,
      factIds: match.factIds,
    })),
    skipped: [],
  });

  return { changeSet, tailoredResume, matches, report };
}

/** Drop removed items and record, on each surviving item, the requirements it answers. */
function applySelection(
  resume: ResumeIR,
  removedItemIds: ReadonlySet<string>,
  requirementIdsByItem: ReadonlyMap<string, string[]>,
): ResumeIR {
  const keepItems = (items: ResumeIR["summary"]) =>
    items
      .filter((item) => !removedItemIds.has(item.id))
      .map((item) => ({ ...item, requirementIds: requirementIdsByItem.get(item.id) ?? [] }));

  return ResumeIRSchema.parse({
    ...resume,
    summary: keepItems(resume.summary),
    skills: keepItems(resume.skills),
    projects: keepItems(resume.projects),
    education: keepItems(resume.education),
    // An experience entry survives on its own facts, even when every bullet is dropped:
    // its role, organization, and dates are verified facts in their own right.
    experience: resume.experience.map((entry) => ({ ...entry, bullets: keepItems(entry.bullets) })),
  });
}
