import { FactSchema, type Fact, type SourceLocator } from "@resume-agent/contracts";

import { ResumeImportError } from "./errors.js";

export interface FactMergeResult {
  facts: Fact[];
  addedFactIds: string[];
  updatedFactIds: string[];
  unchangedFactIds: string[];
}

function sourceKey(source: SourceLocator): string {
  return `${source.artifactId}|${source.locator}`;
}

/**
 * Merge a fresh import into the facts already held for a profile.
 *
 * A re-import never overwrites a decision: an existing verified or rejected fact keeps
 * its status, version, and decision record, and only gains the new source citation.
 * Facts that the new document no longer contains are kept, because a missing line is
 * not evidence that a fact became false.
 */
export function mergeImportedFacts(
  existingInput: readonly Fact[],
  importedInput: readonly Fact[],
): FactMergeResult {
  const existing = existingInput.map((fact) => FactSchema.parse(fact));
  const imported = importedInput.map((fact) => FactSchema.parse(fact));
  const profileIds = new Set([...existing, ...imported].map((fact) => fact.profileId));
  if (profileIds.size > 1) {
    throw new ResumeImportError("PROFILE_MISMATCH", "Facts from different profiles cannot be merged.");
  }

  const byId = new Map(existing.map((fact) => [fact.id, fact]));
  const addedFactIds: string[] = [];
  const updatedFactIds: string[] = [];
  const unchangedFactIds: string[] = [];

  for (const fact of imported) {
    const current = byId.get(fact.id);
    if (!current) {
      byId.set(fact.id, fact);
      addedFactIds.push(fact.id);
      continue;
    }

    const knownSources = new Set(current.sources.map(sourceKey));
    const newSources = fact.sources.filter((source) => !knownSources.has(sourceKey(source)));
    if (newSources.length === 0) {
      unchangedFactIds.push(fact.id);
      continue;
    }

    byId.set(
      fact.id,
      FactSchema.parse({
        ...current,
        sources: [...current.sources, ...newSources],
        updatedAt: fact.updatedAt > current.updatedAt ? fact.updatedAt : current.updatedAt,
      }),
    );
    updatedFactIds.push(fact.id);
  }

  return {
    facts: [...byId.values()],
    addedFactIds,
    updatedFactIds,
    unchangedFactIds,
  };
}
