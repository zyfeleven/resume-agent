import { ResumeVersionRestoreSchema, type ResumeVersionRestore } from "@resume-agent/contracts";
import { resolveResumeTemplate } from "@resume-agent/document-build";

import { hashJson } from "./hash";
import type { ResumeStore } from "./resume-store";

export class ResumeRestoreError extends Error {
  constructor(
    readonly code:
      | "VERSION_NOT_FOUND"
      | "VERSION_NOT_APPROVED"
      | "VERSION_TAMPERED"
      | "LINEAGE_MISSING"
      | "TEMPLATE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "ResumeRestoreError";
  }
}

/** Re-select an immutable approved snapshot and append a hash-bound restore record. */
export function restoreResumeVersion(
  store: ResumeStore,
  input: { versionId: string; restoredBy: string; restoredAt: string },
): { store: ResumeStore; restore: ResumeVersionRestore } {
  const version = store.versions.find((entry) => entry.id === input.versionId);
  if (!version) throw new ResumeRestoreError("VERSION_NOT_FOUND", "That resume version is not stored locally.");

  const approval = store.approvals.find((entry) => entry.resumeVersionId === version.id);
  if (!approval || !version.changeSetId) {
    throw new ResumeRestoreError("VERSION_NOT_APPROVED", "Only an explicitly approved resume version can be restored.");
  }
  if (
    hashJson(version.resume) !== version.contentHash ||
    approval.approvedContentHash !== version.contentHash ||
    approval.profileId !== version.profileId ||
    approval.jobId !== version.jobId
  ) {
    throw new ResumeRestoreError("VERSION_TAMPERED", "The stored version no longer matches the content that was approved.");
  }

  const changeSet = store.changeSets.find((entry) => entry.id === version.changeSetId);
  const baseVersion = store.versions.find((entry) => entry.id === changeSet?.baseResumeVersionId);
  if (
    !changeSet ||
    !baseVersion ||
    approval.changeSetId !== changeSet.id ||
    approval.changeSetHash !== changeSet.contentHash ||
    changeSet.baseContentHash !== baseVersion.contentHash ||
    version.parentVersionId !== baseVersion.id
  ) {
    throw new ResumeRestoreError("LINEAGE_MISSING", "The version's approval, change set, or parent snapshot is missing or stale.");
  }

  try {
    resolveResumeTemplate(version.templateId);
  } catch {
    throw new ResumeRestoreError("TEMPLATE_UNAVAILABLE", "The template required by this version is not available.");
  }

  const sourceApprovalHash = hashJson(approval);
  const payload = {
    sourceVersionId: version.id,
    sourceApprovalId: approval.id,
    sourceContentHash: version.contentHash,
    sourceApprovalHash,
    ...(store.activeResumeVersionId === undefined
      ? {}
      : { previousActiveVersionId: store.activeResumeVersionId }),
    restoredBy: input.restoredBy,
    restoredAt: input.restoredAt,
  };
  const restoreHash = hashJson(payload);
  const restore = ResumeVersionRestoreSchema.parse({
    id: `resume-restore:${restoreHash.slice(0, 24)}`,
    ...payload,
    restoreHash,
  });

  return {
    restore,
    store: {
      ...store,
      activeResumeVersionId: version.id,
      versionRestores: [...store.versionRestores.filter((entry) => entry.id !== restore.id), restore],
    },
  };
}
