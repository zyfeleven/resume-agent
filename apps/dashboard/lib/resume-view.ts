import type { DocumentBuildReport, ResumeDocumentBuild } from "@resume-agent/contracts";

import { documentFileName } from "./document-name";
import type { JobStore } from "./job-store";
import { readJobStore } from "./job-store";
import type { ProfileStore } from "./profile-store";
import { readProfileStore } from "./profile-store";
import { toTailoredView, type ResumePayload } from "./resume-payload";
import type { ResumeStore } from "./resume-store";

export interface DocumentView {
  build: ResumeDocumentBuild;
  report: DocumentBuildReport | null;
  downloadUrl: string;
  fileName: string;
}

export interface ResumeStatePayload extends ResumePayload {
  /** Set once the reviewed content has been approved. */
  approval: { id: string; decidedAt: string; approvedContentHash: string } | null;
  versionStatus: string | null;
  document: DocumentView | null;
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

  const jobs = jobStore.jobs.map((job) => ({ id: job.id, title: job.title, company: job.company }));
  const verifiedFactCount = profile.facts.filter((fact) => fact.status === "verified").length;
  const empty = { jobs, verifiedFactCount, tailored: null, blocked: null, approval: null, versionStatus: null, document: null };

  const changeSet = changeSetId
    ? store.changeSets.find((entry) => entry.id === changeSetId)
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

  const approval =
    [...store.approvals]
      .filter((entry) => entry.changeSetId === changeSet.id)
      .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0] ?? null;

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
      facts: profile.facts,
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
        }
      : null,
  };
}
