import { ArtifactSchema, JobSchema, ResumeVersionSchema } from "@resume-agent/contracts";
import { parseJobDescription } from "@resume-agent/jd-analysis";
import { buildBaseResume, checkChangeSetClaims, checkSemanticClaims } from "@resume-agent/resume-tailor";
import { GeminiResumeProvider } from "./gemini-resume-provider";
import { readJdSource } from "./jd-source";
import { readJobStore, updateJobStore } from "./job-store";
import { writeArtifactFile } from "./local-store";
import { LOCAL_PROFILE_ID, readProfileStore, usableProfileFacts } from "./profile-store";
import { createResumeIntelligenceChangeSet, type ResumeIntelligenceProvider } from "./resume-intelligence";
import { DEFAULT_TEMPLATE_ID, updateResumeStore } from "./resume-store";
import type { DiscoveredJob } from "./discovery-model";
import { sha256 } from "./job-discovery";

export class ResumePreparationError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}

/** Idempotent import: one local job per discovered posting and exact JD snapshot. */
export async function importDiscoveredJob(candidate: DiscoveredJob): Promise<string> {
  const source = readJdSource(candidate.description);
  const id = `job:discovery:${sha256(`${candidate.id}:${candidate.fingerprint}`).slice(0, 32)}`;
  const now = new Date().toISOString();
  const parsed = parseJobDescription({ jobId: id, source: { artifactId: source.artifactId, contentHash: source.contentHash, byteSize: source.byteSize }, text: source.text, parsedAt: now });
  const job = JobSchema.parse({ id, title: candidate.title, company: candidate.company, location: candidate.location,
    sourceUrl: candidate.url, descriptionArtifactId: source.artifactId, descriptionHash: source.contentHash,
    status: "active", createdAt: now, updatedAt: now });
  const artifact = ArtifactSchema.parse({ id: source.artifactId, kind: "job_description", fileName: source.storedFileName,
    mediaType: "text/plain", contentHash: source.contentHash, byteSize: source.byteSize,
    storageKey: `local:${source.storedFileName}`, sensitivity: "normal", createdAt: now });
  await writeArtifactFile("jobs", source.storedFileName, source.bytes);
  await updateJobStore((current) => current.jobs.some((entry) => entry.id === id) ? current : ({
    ...current, jobs: [...current.jobs, job],
    artifacts: [...current.artifacts.filter((entry) => entry.id !== artifact.id), artifact],
    reports: [...current.reports, parsed.report], requirements: [...current.requirements, ...parsed.requirements],
  }));
  return id;
}

/** Shared by the Agent and the existing AI resume endpoint. No review or approval is automated. */
export async function generateGeminiResume(jobId: string, provider?: ResumeIntelligenceProvider) {
  const optimizer = provider ?? GeminiResumeProvider.fromEnvironment();
  const [profile, jobs] = await Promise.all([readProfileStore(), readJobStore()]);
  const facts = usableProfileFacts(profile);
  const job = jobs.jobs.find((entry) => entry.id === jobId);
  if (!job) throw new ResumePreparationError("job_not_found", "The job was removed. Import or search for it again.", 404);
  const requirements = jobs.requirements.filter((entry) => entry.jobId === jobId);
  if (!requirements.length) throw new ResumePreparationError("no_requirements", "No requirements were extracted. Review the description in Jobs.");
  const base = buildBaseResume(LOCAL_PROFILE_ID, facts);
  const generatedAt = new Date().toISOString();
  const baseVersion = ResumeVersionSchema.parse({ id: `resume-version:${base.contentHash.slice(0, 24)}`, profileId: LOCAL_PROFILE_ID,
    templateId: DEFAULT_TEMPLATE_ID, resume: base.resume, status: "draft", contentHash: base.contentHash,
    createdAt: generatedAt, updatedAt: generatedAt });
  const intelligence = await createResumeIntelligenceChangeSet({ job, profileId: LOCAL_PROFILE_ID, baseResume: base.resume,
    baseResumeVersionId: baseVersion.id, requirements, facts, provider: optimizer, generatedAt });
  // Evidence may change while a provider request is in flight. Never publish a stale plan as ready.
  const [freshProfile, freshJobs] = await Promise.all([readProfileStore(), readJobStore()]);
  if (JSON.stringify(usableProfileFacts(freshProfile)) !== JSON.stringify(facts)
    || JSON.stringify(freshJobs.jobs.find((entry) => entry.id === jobId)) !== JSON.stringify(job)
    || JSON.stringify(freshJobs.requirements.filter((entry) => entry.jobId === jobId)) !== JSON.stringify(requirements)) {
    throw new ResumePreparationError("stale_evidence", "Profile or job evidence changed during generation. Review the changes and retry.");
  }
  const input = { changeSet: intelligence.changeSet, baseResume: base.resume, finalizedResume: intelligence.proposedResume, facts, requirements, checkedAt: generatedAt };
  const guard = checkChangeSetClaims(input);
  const semanticGuard = checkSemanticClaims(input);
  const id = intelligence.changeSet.id;
  const store = await updateResumeStore((current) => ({ ...current,
    versions: [...current.versions.filter((entry) => entry.id !== baseVersion.id), baseVersion],
    changeSets: [...current.changeSets.filter((entry) => entry.id !== id), intelligence.changeSet],
    reports: [...current.reports.filter((entry) => entry.changeSetId !== id), { ...intelligence.report, skipped: base.skipped }],
    guardReports: [...current.guardReports.filter((entry) => entry.changeSetId !== id), guard],
    semanticGuardReports: [...current.semanticGuardReports.filter((entry) => entry.changeSetId !== id), semanticGuard],
    matchSets: [...current.matchSets.filter((entry) => entry.changeSetId !== id), { changeSetId: id, matches: intelligence.matches }],
    reviews: current.reviews.filter((entry) => entry.changeSetId !== id),
    sentenceReviews: current.sentenceReviews.filter((entry) => entry.changeSetId !== id),
    approvals: current.approvals.filter((entry) => entry.changeSetId !== id),
    builds: current.builds.filter((entry) => entry.changeSetId !== id),
  }));
  return { store, intelligence, guard, semanticGuard, requirementCount: requirements.length };
}
