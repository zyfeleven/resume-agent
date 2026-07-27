import type { Fact, ResumeImportReport } from "@resume-agent/contracts";
import { factReviewHash, summarizeFactReview, type FactReviewSummary } from "@resume-agent/resume-import";

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

export interface ProfilePayload {
  displayName: string | null;
  facts: Fact[];
  /** Digest of the value shown for each fact. A review decision must echo it back. */
  reviewHashes: Record<string, string>;
  summary: FactReviewSummary;
  sources: ProfileSourceView[];
}

export function toProfilePayload(store: ProfileStore): ProfilePayload {
  const artifactsById = new Map(store.artifacts.map((artifact) => [artifact.id, artifact]));
  const facts = [...store.facts].sort((left, right) => left.key.localeCompare(right.key));

  return {
    displayName: store.profile?.displayName ?? null,
    facts,
    reviewHashes: Object.fromEntries(store.facts.map((fact) => [fact.id, factReviewHash(fact)])),
    summary: summarizeFactReview(store.facts),
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
