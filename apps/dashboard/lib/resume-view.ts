import type { DocumentBuildReport, ResumeDocumentBuild } from "@resume-agent/contracts";
import { conflictedFactIds } from "@resume-agent/resume-import";

import { documentFileName } from "./document-name";
import { geminiConfiguration, type GeminiConfiguration } from "./gemini-form-provider";
import type { JobStore } from "./job-store";
import { readJobStore } from "./job-store";
import type { ProfileStore } from "./profile-store";
import { readProfileStore, usableProfileFacts } from "./profile-store";
import { toTailoredView, type ResumePayload } from "./resume-payload";
import type { ResumeStore } from "./resume-store";

export interface DocumentView {
  build: ResumeDocumentBuild;
  report: DocumentBuildReport | null;
  downloadUrl: string;
  fileName: string;
  manifestDownloadUrl: string | null;
}

export interface ResumeVersionHistoryView {
  id: string;
  changeSetId: string;
  contentHash: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  job: { id: string; title: string; company: string } | null;
  active: boolean;
  lastRestoredAt: string | null;
}

export interface ResumeStatePayload extends ResumePayload {
  intelligence: GeminiConfiguration;
  /** Set once the reviewed content has been approved. */
  approval: { id: string; decidedAt: string; approvedContentHash: string } | null;
  versionStatus: string | null;
  document: DocumentView | null;
  versionHistory: ResumeVersionHistoryView[];
}

/**
 * Assemble everything Resume Studio shows for one change set: the proposal, the approval
 * that froze it, and the document built from that approval.
 */
export async function buildResumePayload(
  store: ResumeStore,
  changeSetId?: string,
  preloaded?: { profile: ProfileStore; jobStore: JobStore },
): Promise<ResumeStatePayload> {
  const profile = preloaded?.profile ?? (await readProfileStore());
  const jobStore = preloaded?.jobStore ?? (await readJobStore());
  const facts = usableProfileFacts(profile);
  const blockedFactIds = [...conflictedFactIds(profile.facts)];
  const sourceFileNames = Object.fromEntries(
    [...profile.artifacts, ...jobStore.artifacts].map((artifact) => [artifact.id, artifact.fileName]),
  );

  const jobs = jobStore.jobs.map((job) => ({ id: job.id, title: job.title, company: job.company }));
  const verifiedFactCount = facts.filter((fact) => fact.status === "verified").length;
  const approvedVersionIds = new Set(store.approvals.map((entry) => entry.resumeVersionId));
  const versionHistory = store.versions
    .filter((version) => version.changeSetId && approvedVersionIds.has(version.id))
    .map((version) => {
      const job = jobStore.jobs.find((entry) => entry.id === version.jobId);
      const lastRestore = [...store.versionRestores]
        .filter((entry) => entry.sourceVersionId === version.id)
        .sort((left, right) => right.restoredAt.localeCompare(left.restoredAt))[0];
      return {
        id: version.id,
        changeSetId: version.changeSetId as string,
        contentHash: version.contentHash,
        status: version.status,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
        job: job ? { id: job.id, title: job.title, company: job.company } : null,
        active: store.activeResumeVersionId === version.id,
        lastRestoredAt: lastRestore?.restoredAt ?? null,
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const empty = {
    jobs,
    verifiedFactCount,
    tailored: null,
    blocked: null,
    approval: null,
    versionStatus: null,
    document: null,
    versionHistory,
    intelligence: geminiConfiguration(),
  };

  const activeChangeSetId = store.versions.find((entry) => entry.id === store.activeResumeVersionId)?.changeSetId;
  const selectedChangeSetId = changeSetId ?? activeChangeSetId;
  const changeSet = selectedChangeSetId
    ? store.changeSets.find((entry) => entry.id === selectedChangeSetId)
    : [...store.changeSets].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  if (!changeSet) {
    return empty;
  }

  const job = jobStore.jobs.find((entry) => entry.id === changeSet.jobId);
  const baseVersion = store.versions.find((version) => version.id === changeSet.baseResumeVersionId);
  if (!job || !baseVersion) {
    return {
      ...empty,
      blocked: { reason: "The job or base resume behind this change set is no longer stored. Generate it again." },
    };
  }

  const activeVersion = store.versions.find(
    (entry) => entry.id === store.activeResumeVersionId && entry.changeSetId === changeSet.id,
  );
  const activeApproval = activeVersion
    ? store.approvals.find((entry) => entry.resumeVersionId === activeVersion.id)
    : undefined;
  const approval =
    activeApproval ??
    ([...store.approvals]
      .filter((entry) => entry.changeSetId === changeSet.id)
      .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0] ?? null);

  const approvedVersion = approval ? store.versions.find((version) => version.id === approval.resumeVersionId) : undefined;

  const build = approval
    ? ([...store.builds]
        .filter((entry) => entry.contentApprovalId === approval.id)
        .sort((left, right) => right.builtAt.localeCompare(left.builtAt))[0] ?? null)
    : null;

  return {
    jobs,
    verifiedFactCount,
    blocked: null,
    tailored: toTailoredView({
      store,
      changeSet,
      baseResume: baseVersion.resume,
      job,
      facts,
      allFacts: profile.facts,
      blockedFactIds,
      sourceFileNames,
      requirements: jobStore.requirements.filter((requirement) => requirement.jobId === job.id),
    }),
    approval: approval
      ? { id: approval.id, decidedAt: approval.decidedAt, approvedContentHash: approval.approvedContentHash }
      : null,
    versionStatus: approvedVersion?.status ?? null,
    document: build
      ? {
          build,
          report: store.buildReports.find((entry) => entry.buildId === build.id) ?? null,
          downloadUrl: `/api/resume/document?buildId=${encodeURIComponent(build.id)}`,
          fileName: documentFileName(job),
          manifestDownloadUrl: store.artifactManifests.some((entry) => entry.buildId === build.id)
            ? `/api/resume/manifest?buildId=${encodeURIComponent(build.id)}`
            : null,
        }
      : null,
    versionHistory,
    intelligence: geminiConfiguration(),
  };
}
