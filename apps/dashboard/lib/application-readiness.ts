import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditDocumentPackage, documentBuildReportPassesDownloadGate, verifyDocumentRenderEvidence, verifyResumeArtifactManifest } from "@resume-agent/document-build";
import { applyReviewedChanges, checkChangeSetClaims, checkSemanticClaims } from "@resume-agent/resume-tailor";
import type { DiscoveryStore } from "./discovery-model";
import { hashBytes, hashJson } from "./hash";
import { readJdSource } from "./jd-source";
import type { JobStore } from "./job-store";
import { artifactDirectory } from "./local-store";
import { usableProfileFacts, type ProfileStore } from "./profile-store";
import { approveResumeContent } from "./resume-lifecycle";
import type { ResumeStore } from "./resume-store";

type StepId = "posting" | "resume" | "review" | "claims" | "approval" | "document" | "submission";
export interface ReadinessStep {
  id: StepId;
  label: string;
  status: "passed" | "action_required" | "blocked" | "waiting" | "unavailable";
  detail: string;
}
export interface ApplicationReadiness {
  taskId: string;
  title: string;
  company: string;
  location: string;
  postingUrl: string | null;
  lastSeenAt: string | null;
  checkedAt: string;
  taskMessage: string;
  steps: ReadinessStep[];
  resumeUrl: string | null;
  downloadUrl: string | null;
  documentVerified: boolean;
  canSubmit: false;
}
export interface ReadinessInput {
  discovery: DiscoveryStore;
  profile: ProfileStore;
  jobs: JobStore;
  resumes: ResumeStore;
  checkedAt?: string;
}

/** Read-only projection. Never persist approval, invoke a model, or contact an ATS.
 * Download/runner operations must revalidate; this view is not an authorization token.
 */
export async function applicationReadiness(
  taskId: string,
  input: ReadinessInput,
  readDocument: (hash: string) => Promise<Uint8Array> = (hash) => readFile(path.join(artifactDirectory("documents"), `${hash}.docx`)),
): Promise<ApplicationReadiness | null> {
  const task = input.discovery.tasks.find((entry) => entry.id === taskId);
  if (!task) return null;
  const candidate = input.discovery.jobs.find((entry) => entry.id === task.candidateId);
  const result: ApplicationReadiness = {
    taskId, title: candidate?.title ?? "Posting no longer stored", company: candidate?.company ?? "Unknown company",
    location: candidate?.location ?? "", postingUrl: candidate?.url ?? null, lastSeenAt: candidate?.lastSeenAt ?? null,
    checkedAt: input.checkedAt ?? new Date().toISOString(), taskMessage: task.message,
    resumeUrl: null, downloadUrl: null, documentVerified: false, canSubmit: false,
    steps: [
      { id: "posting", label: "Posting approval", status: "waiting", detail: "Waiting for posting approval." },
      { id: "resume", label: "Resume linked to this posting", status: "waiting", detail: "Waiting for an approved posting." },
      { id: "review", label: "Sentence review", status: "waiting", detail: "Waiting for a linked resume." },
      { id: "claims", label: "Current facts and claim checks", status: "waiting", detail: "Waiting for a linked resume." },
      { id: "approval", label: "Exact content approval", status: "waiting", detail: "Waiting for review and current claim checks." },
      { id: "document", label: "Verified DOCX", status: "waiting", detail: "Waiting for approved content." },
      { id: "submission", label: "Real-site application", status: "unavailable", detail: "Employer delivery, uploads and submission are not connected. A separate supervised offline text-fill pilot is available below after answer and plan review; preparation approval alone never permits typing or submission." },
    ],
  };
  const set = (id: StepId, status: ReadinessStep["status"], detail: string) => {
    Object.assign(result.steps.find((step) => step.id === id)!, { status, detail });
  };
  if (!candidate || candidate.availability !== "open" || candidate.decision !== "approved"
    || candidate.decisionHash !== candidate.fingerprint || task.approvedHash !== candidate.fingerprint
    || ["cancelled", "needs_reapproval"].includes(task.state)) {
    set("posting", "blocked", "The posting is missing, closed, changed or no longer approved. Return to Job Agent and review it again.");
    return result;
  }
  set("posting", "passed", "Approval matches the last collected posting. This is not a live availability check; refresh the source before applying.");
  const { resumes, jobs, profile } = input;
  const job = jobs.jobs.find((entry) => entry.id === task.jobId);
  const changeSet = resumes.changeSets.find((entry) => entry.id === task.changeSetId);
  const base = resumes.versions.find((entry) => entry.id === changeSet?.baseResumeVersionId);
  if (!task.changeSetId) {
    set("resume", "action_required", task.state === "preparing" ? "Preparation is running. Refresh this page after it finishes." : "Prepare a resume from Job Agent. A configured Gemini key is required for generation.");
    return result;
  }
  if (!job || !changeSet || !base || changeSet.jobId !== job.id || job.status !== "active"
    || job.sourceUrl !== candidate.url || job.title !== candidate.title || job.company !== candidate.company
    || job.descriptionHash !== readJdSource(candidate.description).contentHash) {
    set("resume", "blocked", "The task, posting, imported JD and resume no longer refer to the same source. Generate a new linked resume before continuing.");
    return result;
  }
  result.resumeUrl = `/resume?changeSetId=${encodeURIComponent(changeSet.id)}`;
  set("resume", "passed", "This exact change set belongs to the selected posting and imported JD.");
  let applied: ReturnType<typeof applyReviewedChanges>;
  try {
    applied = applyReviewedChanges(base.resume, changeSet, resumes.reviews, resumes.sentenceReviews);
  } catch {
    set("review", "blocked", "The base resume or stored sentence decisions changed. Regenerate and review this resume again.");
    return result;
  }
  set("review", applied.pendingChangeIds.length ? "action_required" : "passed", applied.pendingChangeIds.length
    ? `${applied.pendingChangeIds.length} sentence decision(s) remain. Open Resume Studio to approve or reject each proposal.`
    : "Every proposed sentence has a current review decision.");
  const facts = usableProfileFacts(profile);
  const context = { changeSet, baseResume: base.resume, finalizedResume: applied.resume, facts,
    requirements: jobs.requirements.filter((entry) => entry.jobId === job.id), checkedAt: result.checkedAt };
  const guard = checkChangeSetClaims(context);
  const semanticGuard = checkSemanticClaims(context);
  try {
    // Replay existing lifecycle guards without writing an approval record.
    approveResumeContent({ resumeVersionId: "resume-version:readiness-check", approvedContentHash: applied.contentHash,
      changeSetId: changeSet.id, changeSet, deterministicGuard: guard, semanticGuard,
      resume: applied.resume, facts, occurredAt: result.checkedAt });
    set("claims", "passed", "Both local claim guards and fact-verification gates pass for the current wording and evidence. No new Gemini request was made.");
  } catch {
    set("claims", "blocked", "Current facts, requirements or wording do not pass the existing claim/verification gates. Review Profile and Resume Studio, then regenerate if needed.");
    return result;
  }
  if (applied.pendingChangeIds.length) return result;
  const approval = [...resumes.approvals].filter((entry) => entry.changeSetId === changeSet.id)
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
  const version = resumes.versions.find((entry) => entry.id === approval?.resumeVersionId);
  if (!approval) {
    set("approval", "action_required", "Sentence review does not approve the final document. Approve the reviewed content in Resume Studio.");
    return result;
  }
  if (!version || approval.jobId !== job.id || approval.profileId !== base.resume.profileId
    || approval.changeSetHash !== changeSet.contentHash || approval.approvedContentHash !== applied.contentHash
    || version.changeSetId !== changeSet.id || version.jobId !== job.id || version.profileId !== approval.profileId
    || version.contentHash !== applied.contentHash || hashJson(version.resume) !== applied.contentHash
    || approval.approvedPresentationHash !== hashJson([version.templateId, applied.contentHash])
    || !["user_approved", "docx_built", "qa_passed", "finalized"].includes(version.status)) {
    set("approval", "blocked", "The stored approval/version does not match the currently reviewed wording and presentation. Approve the current content again.");
    return result;
  }
  set("approval", "passed", "The stored user approval matches this exact reviewed content and presentation.");
  const build = [...resumes.builds].filter((entry) => entry.contentApprovalId === approval.id)
    .sort((a, b) => b.builtAt.localeCompare(a.builtAt))[0];
  if (!build) {
    set("document", "action_required", "Build and visually verify the approved DOCX in Resume Studio.");
    return result;
  }
  const report = resumes.buildReports.find((entry) => entry.buildId === build.id);
  const manifest = resumes.artifactManifests.find((entry) => entry.buildId === build.id);
  if (!report || !manifest || build.jobId !== job.id || build.profileId !== approval.profileId
    || build.templateId !== version.templateId || !/^[a-f0-9]{64}$/.test(build.outputHash)
    || !documentBuildReportPassesDownloadGate(report)
    || !verifyResumeArtifactManifest({ manifest, build, report, approval, changeSet })) {
    set("document", "blocked", "The DOCX is missing valid build, manifest or rendering evidence. Rebuild and verify it in Resume Studio.");
    return result;
  }
  try {
    const bytes = await readDocument(build.outputHash);
    if (hashBytes(bytes) !== build.outputHash || bytes.byteLength !== build.outputByteSize
      || auditDocumentPackage(bytes).failures.length || verifyDocumentRenderEvidence(build, bytes, report.renderEvidence).failures.length) {
      set("document", "blocked", "The stored DOCX fails its hash, package or render-evidence check. Rebuild it before use.");
      return result;
    }
  } catch {
    set("document", "blocked", "The stored DOCX could not be read or verified. Rebuild it before use.");
    return result;
  }
  set("document", "passed", "The local DOCX bytes, manifest and rendering evidence pass verification. Download rechecks the artifact; this does not authorize an application.");
  result.documentVerified = true;
  result.downloadUrl = `/api/resume/document?buildId=${encodeURIComponent(build.id)}`;
  return result;
}
