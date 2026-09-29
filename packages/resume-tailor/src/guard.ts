import {
  ClaimGuardReportSchema,
  ResumeChangeSetSchema,
  type ClaimGuardReport,
  type ClaimViolation,
  type Fact,
  type JDRequirement,
  type ResumeChange,
  type ResumeIR,
} from "@resume-agent/contracts";

import { factSnapshotHash, hashJson, resumeItems } from "./base.js";
import { tokenize } from "./match.js";

export const GUARD_VERSION = "claim-guard-v2";
export const SEMANTIC_GUARD_VERSION = "semantic-claim-guard-v1";

export interface ClaimGuardInput {
  changeSet: unknown;
  baseResume: ResumeIR;
  /** When present, check this exact reviewed wording instead of only the proposal. */
  finalizedResume?: ResumeIR;
  facts: readonly Fact[];
  requirements: readonly JDRequirement[];
  checkedAt: string;
}

function factText(fact: Fact): string {
  return typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
}

/** Digits carry the claims people are most often tempted to invent, so they are checked exactly. */
function numbers(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((match) => match[0].replace(/,/g, ""));
}

function originalText(change: ResumeChange): string {
  return Array.isArray(change.before) ? change.before.join(" ") : change.before;
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
}

function checkedText(
  change: ResumeChange,
  finalizedItems: ReadonlyMap<string, { text: string }> | null,
): string | null {
  if (finalizedItems) return finalizedItems.get(change.targetItemId)?.text ?? null;
  return change.intent === "rewrite" || change.intent === "combine" ? change.after : null;
}

/**
 * Decide whether a change set may reach review or approval using exact snapshots,
 * citations, lexical support, and numeric support.
 */
export function checkChangeSetClaims(input: ClaimGuardInput): ClaimGuardReport {
  const changeSet = ResumeChangeSetSchema.parse(input.changeSet);
  const violations: ClaimViolation[] = [];

  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const requirementsById = new Map(input.requirements.map((requirement) => [requirement.id, requirement]));
  const itemsById = new Map(resumeItems(input.baseResume).map(({ item }) => [item.id, item]));
  const finalizedItems = input.finalizedResume
    ? new Map(resumeItems(input.finalizedResume).map(({ item }) => [item.id, item]))
    : null;

  if (changeSet.baseContentHash !== hashJson(input.baseResume)) {
    violations.push({
      code: "before_text_altered",
      detail: "The base resume no longer matches the content this change set was generated from.",
    });
  }

  if (changeSet.requirementSnapshotHash) {
    const currentRequirementSnapshot = hashJson(
      [...input.requirements]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((requirement) => [requirement.id, requirement.priority, requirement.text]),
    );
    if (changeSet.requirementSnapshotHash !== currentRequirementSnapshot) {
      violations.push({
        code: "requirement_not_in_snapshot",
        detail: "The job requirements changed after this change set was generated. Generate it again.",
      });
    }
  }

  if (changeSet.factSnapshotHash !== factSnapshotHash(input.facts)) {
    violations.push({
      code: "fact_snapshot_mismatch",
      detail: "The verified facts changed after this change set was generated. Generate it again.",
    });
  }

  for (const change of changeSet.changes) {
    const citedFacts: Fact[] = [];

    for (const factId of change.factIds) {
      const fact = factsById.get(factId);
      if (!fact) {
        violations.push({
          changeId: change.id,
          code: "fact_not_in_snapshot",
          detail: `Change cites fact ${factId}, which is not in this profile.`,
        });
        continue;
      }
      if (fact.profileId !== input.baseResume.profileId) {
        violations.push({
          changeId: change.id,
          code: "fact_not_in_snapshot",
          detail: `Change cites fact ${factId}, which belongs to another profile.`,
        });
        continue;
      }
      if (fact.status !== "verified") {
        violations.push({
          changeId: change.id,
          code: "fact_not_verified",
          detail: `Change cites fact ${factId}, which is ${fact.status} rather than verified.`,
        });
        continue;
      }
      citedFacts.push(fact);
    }

    for (const requirementId of change.requirementIds) {
      const requirement = requirementsById.get(requirementId);
      if (!requirement || requirement.jobId !== changeSet.jobId) {
        violations.push({
          changeId: change.id,
          code: "requirement_not_in_snapshot",
          detail: `Change cites requirement ${requirementId}, which is not in this job.`,
        });
      }
    }

    const target = itemsById.get(change.targetItemId);
    if (!target) {
      violations.push({
        changeId: change.id,
        code: "before_text_altered",
        detail: "The change targets a resume item that is not present in the cited base resume.",
      });
    }
    const beforeTexts = Array.isArray(change.before) ? change.before : [change.before];
    if (target && !beforeTexts.includes(target.text)) {
      violations.push({
        changeId: change.id,
        code: "before_text_altered",
        detail: "The change reports different original wording than the resume it targets.",
      });
    }
    if (target && !target.factIds.every((factId) => change.factIds.includes(factId))) {
      violations.push({
        changeId: change.id,
        code: "fact_not_in_snapshot",
        detail: "The change does not cite every fact behind the resume item it targets.",
      });
    }

    const wording = checkedText(change, finalizedItems);
    if (wording === null || normalized(wording) === normalized(originalText(change))) continue;

    const supportText = citedFacts.map(factText).join(" ");
    const supportTokens = tokenize(supportText);
    const unsupported = [...tokenize(wording)].filter((token) => !supportTokens.has(token));
    if (unsupported.length > 0) {
      violations.push({
        changeId: change.id,
        code: "unsupported_claim",
        detail: `Reviewed wording introduces ${unsupported.length} term(s) absent from the cited facts: ${unsupported
          .slice(0, 5)
          .join(", ")}.`,
      });
    }

    const supportNumbers = new Set(numbers(supportText));
    const unsupportedNumbers = numbers(wording).filter((value) => !supportNumbers.has(value));
    if (unsupportedNumbers.length > 0) {
      violations.push({
        changeId: change.id,
        code: "unsupported_number",
        detail: `Reviewed wording states figures absent from the cited facts: ${unsupportedNumbers.slice(0, 5).join(", ")}.`,
      });
    }
  }

  return ClaimGuardReportSchema.parse({
    changeSetId: changeSet.id,
    layer: "deterministic",
    guardVersion: GUARD_VERSION,
    checkedAt: input.checkedAt,
    ...(input.finalizedResume ? { contentHash: hashJson(input.finalizedResume) } : {}),
    passed: violations.length === 0,
    violations,
  });
}

const NEGATION = /\b(?:no|not|never|neither|without|didn't|did not|wasn't|was not)\b/i;
const INCREASE = /\b(?:increase|increased|increasing|grew|grown|raise|raised|improve|improved|accelerate|accelerated)\b/i;
const DECREASE = /\b(?:decrease|decreased|decreasing|reduce|reduced|reducing|cut|lower|lowered|decline|declined)\b/i;
const HIGH_RESPONSIBILITY = /\b(?:lead|led|leading|own|owned|owner|drive|drove|driven|manage|managed|direct|directed|head|headed|spearhead|spearheaded)\b/i;
const LOW_RESPONSIBILITY = /\b(?:assist|assisted|support|supported|contribute|contributed|collaborate|collaborated|participate|participated)\b/i;
const HIGH_PROFICIENCY = /\b(?:expert|expertise|master|mastered|mastery|advanced|authority|specialist)\b/i;
const LOW_PROFICIENCY = /\b(?:familiar|familiarity|basic|beginner|exposure|introductory|working knowledge)\b/i;

function semanticViolation(changeId: string, code: ClaimViolation["code"], detail: string): ClaimViolation {
  return { changeId, code, detail };
}

/**
 * Check meaning-changing contradiction patterns independently of lexical support.
 * Both this report and the deterministic report are required at approval.
 */
export function checkSemanticClaims(input: ClaimGuardInput & { finalizedResume: ResumeIR }): ClaimGuardReport {
  const changeSet = ResumeChangeSetSchema.parse(input.changeSet);
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const finalizedItems = new Map(resumeItems(input.finalizedResume).map(({ item }) => [item.id, item]));
  const violations: ClaimViolation[] = [];

  for (const change of changeSet.changes) {
    const wording = finalizedItems.get(change.targetItemId)?.text;
    if (!wording || normalized(wording) === normalized(originalText(change))) continue;

    const support = change.factIds
      .map((factId) => factsById.get(factId))
      .filter((fact): fact is Fact => fact?.status === "verified")
      .map(factText)
      .join(" ");
    if (!support) continue;

    if (NEGATION.test(wording) !== NEGATION.test(support)) {
      violations.push(
        semanticViolation(
          change.id,
          "semantic_negation_conflict",
          "The reviewed wording changes the claim's positive/negative meaning relative to its cited facts.",
        ),
      );
    }
    if ((INCREASE.test(wording) && DECREASE.test(support)) || (DECREASE.test(wording) && INCREASE.test(support))) {
      violations.push(
        semanticViolation(
          change.id,
          "semantic_direction_conflict",
          "The reviewed wording reverses the outcome direction stated by its cited facts.",
        ),
      );
    }
    if (HIGH_RESPONSIBILITY.test(wording) && LOW_RESPONSIBILITY.test(support) && !HIGH_RESPONSIBILITY.test(support)) {
      violations.push(
        semanticViolation(
          change.id,
          "semantic_responsibility_inflation",
          "The reviewed wording upgrades a supporting or contributing role into ownership or leadership.",
        ),
      );
    }
    if (HIGH_PROFICIENCY.test(wording) && LOW_PROFICIENCY.test(support) && !HIGH_PROFICIENCY.test(support)) {
      violations.push(
        semanticViolation(
          change.id,
          "semantic_proficiency_inflation",
          "The reviewed wording upgrades limited familiarity into advanced or expert proficiency.",
        ),
      );
    }
  }

  return ClaimGuardReportSchema.parse({
    changeSetId: changeSet.id,
    layer: "semantic",
    guardVersion: SEMANTIC_GUARD_VERSION,
    checkedAt: input.checkedAt,
    contentHash: hashJson(input.finalizedResume),
    passed: violations.length === 0,
    violations,
  });
}

/** Compatibility helper for callers that only need the semantic verdict. */
export function semanticClaimsSatisfied(reportInput: unknown): boolean {
  const report = ClaimGuardReportSchema.parse(reportInput);
  return report.layer === "semantic" && report.passed;
}
