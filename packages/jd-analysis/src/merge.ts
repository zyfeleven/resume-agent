import { JDRequirementSchema, type JDRequirement } from "@resume-agent/contracts";

export interface RequirementMergeResult {
  requirements: JDRequirement[];
  addedRequirementIds: string[];
  correctedRequirementIds: string[];
  removedRequirementIds: string[];
}

/**
 * Fold a fresh parse into the requirements already stored for a job.
 *
 * The parse decides which requirements exist: a requirement the posting no longer
 * contains is dropped, because its ID is derived from text that is no longer there.
 * Where a requirement survives, the reviewer's priority and kind win over the parser's,
 * so re-parsing an unchanged posting does not discard corrections.
 */
export function mergeParsedRequirements(
  existingInput: readonly JDRequirement[],
  parsedInput: readonly JDRequirement[],
): RequirementMergeResult {
  const existing = existingInput.map((requirement) => JDRequirementSchema.parse(requirement));
  const parsed = parsedInput.map((requirement) => JDRequirementSchema.parse(requirement));

  const storedById = new Map(existing.map((requirement) => [requirement.id, requirement]));
  const parsedIds = new Set(parsed.map((requirement) => requirement.id));

  const addedRequirementIds: string[] = [];
  const correctedRequirementIds: string[] = [];

  const requirements = parsed.map((requirement) => {
    const stored = storedById.get(requirement.id);
    if (!stored) {
      addedRequirementIds.push(requirement.id);
      return requirement;
    }
    if (stored.priority === requirement.priority && stored.kind === requirement.kind) {
      return requirement;
    }
    correctedRequirementIds.push(requirement.id);
    return JDRequirementSchema.parse({ ...requirement, priority: stored.priority, kind: stored.kind });
  });

  return {
    requirements,
    addedRequirementIds,
    correctedRequirementIds,
    removedRequirementIds: existing
      .filter((requirement) => !parsedIds.has(requirement.id))
      .map((requirement) => requirement.id),
  };
}
