import type { JDRequirement } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import { JdAnalysisError, applyRequirementReview, parseJobDescription, summarizeRequirements } from "../src/index.js";

const jobDescription = `Requirements
- 5+ years of product design experience.
- Bachelor's degree in design or equivalent practical experience.

Nice to have
- Experience with React.
`;

function requirements(): JDRequirement[] {
  return parseJobDescription({
    jobId: "job:northstar-designer",
    source: { artifactId: "artifact:jd111", contentHash: "c".repeat(64), byteSize: 640 },
    text: jobDescription,
    parsedAt: "2026-07-27T16:00:00-04:00",
  }).requirements;
}

function first(list: readonly JDRequirement[]): JDRequirement {
  const requirement = list[0];
  if (!requirement) {
    throw new Error("fixture produced no requirements");
  }
  return requirement;
}

describe("applyRequirementReview", () => {
  it("lets the reviewer correct a priority", () => {
    const list = requirements();
    const target = first(list);

    const result = applyRequirementReview(list, {
      action: "set_priority",
      requirementId: target.id,
      priority: "preferred",
    });

    expect(result.changed).toBe(true);
    expect(result.requirements.find((requirement) => requirement.id === target.id)?.priority).toBe("preferred");
    expect(result.requirements).toHaveLength(list.length);
  });

  it("lets the reviewer correct a kind", () => {
    const list = requirements();
    const target = first(list);

    const result = applyRequirementReview(list, { action: "set_kind", requirementId: target.id, kind: "skill" });

    expect(result.changed).toBe(true);
    expect(result.requirements.find((requirement) => requirement.id === target.id)?.kind).toBe("skill");
  });

  it("reports no change when the decision matches what is already stored", () => {
    const list = requirements();
    const target = first(list);

    const result = applyRequirementReview(list, {
      action: "set_priority",
      requirementId: target.id,
      priority: target.priority,
    });

    expect(result.changed).toBe(false);
    expect(result.requirements).toEqual(list);
  });

  it("dismisses a requirement the reviewer does not want", () => {
    const list = requirements();
    const target = first(list);

    const result = applyRequirementReview(list, { action: "dismiss", requirementId: target.id });

    expect(result.changed).toBe(true);
    expect(result.requirements.some((requirement) => requirement.id === target.id)).toBe(false);
    expect(result.requirements).toHaveLength(list.length - 1);
  });

  it("refuses a decision for a requirement that is not in the job", () => {
    expect(() => applyRequirementReview(requirements(), { action: "dismiss", requirementId: "requirement:missing" })).toThrow(
      JdAnalysisError,
    );
  });

  it("refuses a decision that does not match the contract", () => {
    const target = first(requirements());

    expect(() => applyRequirementReview(requirements(), { action: "set_priority", requirementId: target.id })).toThrow();
    expect(() =>
      applyRequirementReview(requirements(), { action: "set_priority", requirementId: target.id, priority: "critical" }),
    ).toThrow();
    expect(() => applyRequirementReview(requirements(), { action: "rewrite", requirementId: target.id, text: "new" })).toThrow();
  });

  it("summarizes requirements by priority", () => {
    expect(summarizeRequirements(requirements())).toEqual({ must_have: 2, preferred: 1, context: 0 });
  });
});
