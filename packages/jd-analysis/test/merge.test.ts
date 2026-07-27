import type { JDRequirement } from "@resume-agent/contracts";
import { describe, expect, it } from "vitest";

import { applyRequirementReview, mergeParsedRequirements, parseJobDescription } from "../src/index.js";

const posting = `Requirements
- 5+ years of product design experience.
- Bachelor's degree in design or equivalent practical experience.

Nice to have
- Experience with React.
`;

function parse(text = posting): JDRequirement[] {
  return parseJobDescription({
    jobId: "job:northstar-designer",
    source: { artifactId: "artifact:jd111", contentHash: "c".repeat(64), byteSize: 640 },
    text,
    parsedAt: "2026-07-27T16:00:00-04:00",
  }).requirements;
}

function find(list: readonly JDRequirement[], fragment: string): JDRequirement {
  const match = list.find((requirement) => requirement.text.includes(fragment));
  if (!match) {
    throw new Error(`fixture has no requirement containing ${fragment}`);
  }
  return match;
}

describe("mergeParsedRequirements", () => {
  it("keeps a correction when the same posting is parsed again", () => {
    const original = parse();
    const target = find(original, "Bachelor's degree");
    const corrected = applyRequirementReview(original, {
      action: "set_priority",
      requirementId: target.id,
      priority: "preferred",
    }).requirements;

    const merged = mergeParsedRequirements(corrected, parse());

    expect(merged.correctedRequirementIds).toEqual([target.id]);
    expect(merged.requirements.find((requirement) => requirement.id === target.id)?.priority).toBe("preferred");
    expect(merged.requirements).toHaveLength(original.length);
  });

  it("keeps a corrected kind as well as a corrected priority", () => {
    const original = parse();
    const target = find(original, "5+ years");
    const corrected = applyRequirementReview(original, {
      action: "set_kind",
      requirementId: target.id,
      kind: "skill",
    }).requirements;

    const merged = mergeParsedRequirements(corrected, parse());
    expect(merged.requirements.find((requirement) => requirement.id === target.id)?.kind).toBe("skill");
  });

  it("drops a requirement the posting no longer contains", () => {
    const original = parse();
    const shortened = parse("Requirements\n- 5+ years of product design experience.\n");

    const merged = mergeParsedRequirements(original, shortened);

    expect(merged.requirements).toHaveLength(1);
    expect(merged.removedRequirementIds).toHaveLength(original.length - 1);
    expect(merged.addedRequirementIds).toEqual([]);
  });

  it("adds a requirement the posting gained, and restores a dismissed line", () => {
    const original = parse();
    const target = find(original, "Experience with React");
    const afterDismissal = applyRequirementReview(original, { action: "dismiss", requirementId: target.id }).requirements;

    const merged = mergeParsedRequirements(afterDismissal, parse());

    expect(merged.addedRequirementIds).toEqual([target.id]);
    expect(merged.requirements).toHaveLength(original.length);
  });
});
