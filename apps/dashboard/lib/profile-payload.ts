import type { Fact, ResumeImportReport } from "@resume-agent/contracts";
import {
  conflictedFactIds,
  detectFactConflicts,
  factReviewHash,
  summarizeFactReview,
  type FactConflict,
  type FactReviewSummary,
} from "@resume-agent/resume-import";

import type { ProfileStore } from "./profile-store";

export interface ProfileSourceView {
  artifactId: string;
  fileName: string;
  byteSize: number;
  importedAt: string;
  factCount: number;
  skippedCount: number;
  sections: ResumeImportReport["sections"];
  skipped: ResumeImportReport["skipped"];
}

export interface FactEvidenceView {
  artifactId: string;
  fileName: string;
  importedAt: string | null;
  locator: string;
  excerpt?: string;
}

export interface FactConflictView extends FactConflict {}

export interface ProfilePayload {
  displayName: string | null;
  facts: Fact[];
  /** Digest of the value shown for each fact. A review decision must echo it back. */
  reviewHashes: Record<string, string>;
  summary: FactReviewSummary;
  sources: ProfileSourceView[];
  evidence: Record<string, FactEvidenceView[]>;
  conflicts: FactConflictView[];
  blockedFactIds: string[];
}

export function toProfilePayload(store: ProfileStore): ProfilePayload {
  const artifactsById = new Map(store.artifacts.map((artifact) => [artifact.id, artifact]));
  const importsByArtifactId = new Map(store.imports.map((report) => [report.artifactId, report]));
  const facts = [...store.facts].sort((left, right) => left.key.localeCompare(right.key));
  const conflicts = detectFactConflicts(store.facts);

  return {
    displayName: store.profile?.displayName ?? null,
    facts,
    reviewHashes: Object.fromEntries(store.facts.map((fact) => [fact.id, factReviewHash(fact)])),
    summary: summarizeFactReview(store.facts),
    evidence: Object.fromEntries(
      store.facts.map((fact) => [
        fact.id,
        fact.sources.map((source) => ({
          artifactId: source.artifactId,
          fileName: artifactsById.get(source.artifactId)?.fileName ?? source.artifactId,
          importedAt: importsByArtifactId.get(source.artifactId)?.importedAt ?? null,
          locator: source.locator,
          ...(source.excerpt === undefined ? {} : { excerpt: source.excerpt }),
        })),
      ]),
    ),
    conflicts,
    blockedFactIds: [...conflictedFactIds(store.facts)].sort(),
    sources: [...store.imports]
      .sort((left, right) => right.importedAt.localeCompare(left.importedAt))
      .map((report) => {
        const artifact = artifactsById.get(report.artifactId);
        return {
          artifactId: report.artifactId,
          fileName: artifact?.fileName ?? report.artifactId,
          byteSize: artifact?.byteSize ?? 0,
          importedAt: report.importedAt,
          factCount: report.factIds.length,
          skippedCount: report.skipped.length,
          sections: report.sections,
          skipped: report.skipped,
        };
      }),
  };
}
