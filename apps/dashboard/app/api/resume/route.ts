import { ResumeVersionSchema, type Job } from "@resume-agent/contracts";
import {
  ResumeTailorError,
  buildBaseResume,
  checkChangeSetClaims,
  generateChangeSet,
} from "@resume-agent/resume-tailor";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJobStore } from "../../../lib/job-store";
import { readProfileStore, LOCAL_PROFILE_ID } from "../../../lib/profile-store";
import { toTailoredView, type ResumePayload } from "../../../lib/resume-payload";
import {
  DEFAULT_TEMPLATE_ID,
  clearResumeStore,
  readResumeStore,
  updateResumeStore,
  type ResumeStore,
} from "../../../lib/resume-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GenerateSchema = z.object({ jobId: z.string().min(1).max(128) }).strict();

async function buildPayload(store: ResumeStore, changeSetId?: string): Promise<ResumePayload> {
  const [profile, jobStore] = await Promise.all([readProfileStore(), readJobStore()]);
  const jobs = jobStore.jobs.map((job) => ({ id: job.id, title: job.title, company: job.company }));
  const verifiedFactCount = profile.facts.filter((fact) => fact.status === "verified").length;

  const changeSet = changeSetId
    ? store.changeSets.find((entry) => entry.id === changeSetId)
    : [...store.changeSets].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  if (!changeSet) {
    return { jobs, verifiedFactCount, tailored: null, blocked: null };
  }

  const job = jobStore.jobs.find((entry) => entry.id === changeSet.jobId);
  const baseVersion = store.versions.find((version) => version.id === changeSet.baseResumeVersionId);
  if (!job || !baseVersion) {
    return {
      jobs,
      verifiedFactCount,
      tailored: null,
      blocked: { reason: "The job or base resume behind this change set is no longer stored. Generate it again." },
    };
  }

  return {
    jobs,
    verifiedFactCount,
    blocked: null,
    tailored: toTailoredView({
      store,
      changeSet,
      baseResume: baseVersion.resume,
      job: job as Job,
      facts: profile.facts,
      requirements: jobStore.requirements.filter((requirement) => requirement.jobId === job.id),
    }),
  };
}

export async function GET(request: Request) {
  const changeSetId = new URL(request.url).searchParams.get("changeSetId") ?? undefined;
  return NextResponse.json(await buildPayload(await readResumeStore(), changeSetId));
}

/** Delete every locally stored resume version, change set, and review. */
export async function DELETE() {
  return NextResponse.json(await buildPayload(await clearResumeStore()));
}

/**
 * Generate a change set that tailors the verified-fact resume to one job.
 *
 * The claim guard runs before the result is stored. A change set that fails it is kept
 * with its violations and never presented as a proposal, so unsupported content cannot
 * reach the review screen and be approved by habit.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Send a JSON body with a jobId." }, { status: 400 });
  }

  const parsed = GenerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", message: "Choose a job to tailor for." }, { status: 400 });
  }

  const [profile, jobStore] = await Promise.all([readProfileStore(), readJobStore()]);
  const job = jobStore.jobs.find((entry) => entry.id === parsed.data.jobId);
  if (!job) {
    return NextResponse.json({ error: "job_not_found", message: "That job is not stored locally." }, { status: 404 });
  }

  const requirements = jobStore.requirements.filter((requirement) => requirement.jobId === job.id);
  if (requirements.length === 0) {
    return NextResponse.json(
      { error: "no_requirements", message: "Parse this job description before tailoring a resume for it." },
      { status: 409 },
    );
  }

  const generatedAt = new Date().toISOString();

  let base;
  try {
    base = buildBaseResume(LOCAL_PROFILE_ID, profile.facts);
  } catch (error) {
    if (error instanceof ResumeTailorError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 409 });
    }
    throw error;
  }

  const baseVersion = ResumeVersionSchema.parse({
    id: `resume-version:${base.contentHash.slice(0, 24)}`,
    profileId: LOCAL_PROFILE_ID,
    templateId: DEFAULT_TEMPLATE_ID,
    resume: base.resume,
    status: "draft",
    contentHash: base.contentHash,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  });

  const { changeSet, matches, report } = generateChangeSet({
    jobId: job.id,
    profileId: LOCAL_PROFILE_ID,
    baseResume: base.resume,
    baseResumeVersionId: baseVersion.id,
    requirements,
    facts: profile.facts,
    generatedAt,
  });

  const guard = checkChangeSetClaims({
    changeSet,
    baseResume: base.resume,
    facts: profile.facts,
    requirements,
    checkedAt: generatedAt,
  });

  const store = await updateResumeStore((current) => ({
    ...current,
    versions: [...current.versions.filter((version) => version.id !== baseVersion.id), baseVersion],
    changeSets: [...current.changeSets.filter((entry) => entry.id !== changeSet.id), changeSet],
    reports: [...current.reports.filter((entry) => entry.changeSetId !== changeSet.id), { ...report, skipped: base.skipped }],
    guardReports: [...current.guardReports.filter((entry) => entry.changeSetId !== changeSet.id), guard],
    matchSets: [...current.matchSets.filter((entry) => entry.changeSetId !== changeSet.id), { changeSetId: changeSet.id, matches }],
    // Regenerating invalidates earlier decisions: they were made about different wording.
    reviews: current.reviews.filter((review) => review.changeSetId !== changeSet.id),
  }));

  return NextResponse.json(await buildPayload(store, changeSet.id), { status: 201 });
}
