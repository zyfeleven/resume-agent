import {
  JDRequirementSchema,
  RequirementReviewDecisionSchema,
  type JDRequirement,
} from "@resume-agent/contracts";

import { JdAnalysisError } from "./errors.js";

export interface RequirementReviewResult {
  requirements: JDRequirement[];
  changed: boolean;
}

export interface RequirementSummary {
  must_have: number;
  preferred: number;
  context: number;
}

/**
 * Apply one reviewer correction to a parsed requirement list.
 *
 * The parser classifies from document structure, so the reviewer owns the final call on
 * priority and kind. Corrections never rewrite requirement text: a requirement ID is
 * derived from its text, so changed wording is a different requirement entirely.
 */
export function applyRequirementReview(
  requirementsInput: readonly JDRequirement[],
  decisionInput: unknown,
): RequirementReviewResult {
  const requirements = requirementsInput.map((requirement) => JDRequirementSchema.parse(requirement));
  const decision = RequirementReviewDecisionSchema.parse(decisionInput);

  const target = requirements.find((requirement) => requirement.id === decision.requirementId);
  if (!target) {
    throw new JdAnalysisError("REQUIREMENT_NOT_FOUND", `Requirement ${decision.requirementId} is not in this job.`);
  }

  if (decision.action === "dismiss") {
    return {
      requirements: requirements.filter((requirement) => requirement.id !== decision.requirementId),
      changed: true,
    };
  }

  if (decision.action === "set_priority") {
    if (target.priority === decision.priority) {
      return { requirements, changed: false };
    }
    return {
      requirements: requirements.map((requirement) =>
        requirement.id === decision.requirementId
          ? JDRequirementSchema.parse({ ...requirement, priority: decision.priority })
          : requirement,
      ),
      changed: true,
    };
  }

  if (target.kind === decision.kind) {
    return { requirements, changed: false };
  }
  return {
    requirements: requirements.map((requirement) =>
      requirement.id === decision.requirementId
        ? JDRequirementSchema.parse({ ...requirement, kind: decision.kind })
        : requirement,
    ),
    changed: true,
  };
}

export function summarizeRequirements(requirements: readonly JDRequirement[]): RequirementSummary {
  const summary: RequirementSummary = { must_have: 0, preferred: 0, context: 0 };
  for (const requirement of requirements) {
    summary[requirement.priority] += 1;
  }
  return summary;
}
