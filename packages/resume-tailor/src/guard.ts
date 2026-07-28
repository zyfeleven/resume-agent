import {
  ClaimGuardReportSchema,
  ResumeChangeSetSchema,
  type ClaimGuardReport,
  type ClaimViolation,
  type Fact,
  type JDRequirement,
  type ResumeIR,
} from "@resume-agent/contracts";

import { factSnapshotHash, resumeItems } from "./base.js";
import { tokenize } from "./match.js";

export const GUARD_VERSION = "claim-guard-v1";

/**
 * The semantic half of the claim guard, as far as it can honestly be answered today.
 *
 * A change that only keeps or removes text copied verbatim from a verified fact cannot
 * misrepresent that fact — there is no rewording in which a false implication could hide,
 * so the semantic question is settled by construction. Generated prose is a different
 * question that needs a real semantic check, so this returns false for it rather than
 * waving it through: the resume state machine will not fact-check a version until a
 * genuine check exists.
 */
export function semanticClaimsSatisfied(changeSetInput: unknown): boolean {
  const changeSet = ResumeChangeSetSchema.parse(changeSetInput);
  return changeSet.changes.every((change) => change.intent === "keep" || change.intent === "remove");
}

export interface ClaimGuardInput {
  changeSet: unknown;
  baseResume: ResumeIR;
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

/**
 * Decide whether a change set may be shown to a reviewer at all.
 *
 * This runs identically over a change set built by selection and one written by a model,
 * and it is the reason generated prose can be introduced later without widening the trust
 * boundary: proposed text has to be traceable to the verified facts it cites, or the
 * change set never reaches the review screen.
 */
export function checkChangeSetClaims(input: ClaimGuardInput): ClaimGuardReport {
  const changeSet = ResumeChangeSetSchema.parse(input.changeSet);
  const violations: ClaimViolation[] = [];

  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const requirementIds = new Set(input.requirements.map((requirement) => requirement.id));
  const itemsById = new Map(resumeItems(input.baseResume).map(({ item }) => [item.id, item]));

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
      if (!requirementIds.has(requirementId)) {
        violations.push({
          changeId: change.id,
          code: "requirement_not_in_snapshot",
          detail: `Change cites requirement ${requirementId}, which is not in this job.`,
        });
      }
    }

    const target = itemsById.get(change.targetItemId);
    const beforeTexts = Array.isArray(change.before) ? change.before : [change.before];
    if (target && !beforeTexts.includes(target.text)) {
      violations.push({
        changeId: change.id,
        code: "before_text_altered",
        detail: "The change reports different original wording than the resume it targets.",
      });
    }

    if (change.intent !== "rewrite" && change.intent !== "combine") {
      continue;
    }

    // Proposed wording must be traceable to the facts the change cites.
    const supportText = citedFacts.map(factText).join(" ");
    const supportTokens = tokenize(supportText);
    const unsupported = [...tokenize(change.after)].filter((token) => !supportTokens.has(token));
    if (unsupported.length > 0) {
      violations.push({
        changeId: change.id,
        code: "unsupported_claim",
        detail: `Proposed wording introduces ${unsupported.length} term(s) absent from the cited facts: ${unsupported
          .slice(0, 5)
          .join(", ")}.`,
      });
    }

    const supportNumbers = new Set(numbers(supportText));
    const unsupportedNumbers = numbers(change.after).filter((value) => !supportNumbers.has(value));
    if (unsupportedNumbers.length > 0) {
      violations.push({
        changeId: change.id,
        code: "unsupported_number",
        detail: `Proposed wording states figures absent from the cited facts: ${unsupportedNumbers
          .slice(0, 5)
          .join(", ")}.`,
      });
    }
  }

  return ClaimGuardReportSchema.parse({
    changeSetId: changeSet.id,
    guardVersion: GUARD_VERSION,
    checkedAt: input.checkedAt,
    passed: violations.length === 0,
    violations,
  });
}
