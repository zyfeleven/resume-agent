import { ResumeVersionSchema } from "@resume-agent/contracts";
import {
  ResumeTailorError,
  applyReviewedChanges,
  buildBaseResume,
  checkChangeSetClaims,
  checkSemanticClaims,
  generateChangeSet,
} from "@resume-agent/resume-tailor";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJobStore } from "../../../lib/job-store";
import { buildResumePayload } from "../../../lib/resume-view";
import { readProfileStore, LOCAL_PROFILE_ID, usableProfileFacts } from "../../../lib/profile-store";
import {
  DEFAULT_TEMPLATE_ID,
  clearResumeStore,
  readResumeStore,
  updateResumeStore,
} from "../../../lib/resume-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GenerateSchema = z.object({ jobId: z.string().min(1).max(128) }).strict();

export async function GET(request: Request) {
  const changeSetId = new URL(request.url).searchParams.get("changeSetId") ?? undefined;
  return NextResponse.json(await buildResumePayload(await readResumeStore(), changeSetId));
}

/** Delete every locally stored resume version, change set, and review. */
export async function DELETE() {
  return NextResponse.json(await buildResumePayload(await clearResumeStore()));
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
  const facts = usableProfileFacts(profile);
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
    base = buildBaseResume(LOCAL_PROFILE_ID, facts);
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
    facts,
    generatedAt,
  });
  // Project every proposal before review so future rewrite/combine generators are
  // checked too; today's selection-only generator produces the same tailored resume.
  const proposedResume = applyReviewedChanges(base.resume, changeSet, []).resume;
  const semanticGuard = checkSemanticClaims({
    changeSet,
    baseResume: base.resume,
    finalizedResume: proposedResume,
    facts,
    requirements,
    checkedAt: generatedAt,
  });

  const guard = checkChangeSetClaims({
    changeSet,
    baseResume: base.resume,
    finalizedResume: proposedResume,
    facts,
    requirements,
    checkedAt: generatedAt,
  });

  const store = await updateResumeStore((current) => ({
    ...current,
    versions: [...current.versions.filter((version) => version.id !== baseVersion.id), baseVersion],
    changeSets: [...current.changeSets.filter((entry) => entry.id !== changeSet.id), changeSet],
    reports: [...current.reports.filter((entry) => entry.changeSetId !== changeSet.id), { ...report, skipped: base.skipped }],
    guardReports: [...current.guardReports.filter((entry) => entry.changeSetId !== changeSet.id), guard],
    semanticGuardReports: [
      ...current.semanticGuardReports.filter((entry) => entry.changeSetId !== changeSet.id),
      semanticGuard,
    ],
    matchSets: [...current.matchSets.filter((entry) => entry.changeSetId !== changeSet.id), { changeSetId: changeSet.id, matches }],
    // Regenerating invalidates earlier decisions: they were made about different wording.
    // The approval and document that rested on those decisions go with them.
    reviews: current.reviews.filter((review) => review.changeSetId !== changeSet.id),
    sentenceReviews: current.sentenceReviews.filter((review) => review.changeSetId !== changeSet.id),
    approvals: current.approvals.filter((approval) => approval.changeSetId !== changeSet.id),
    builds: current.builds.filter((build) => build.changeSetId !== changeSet.id),
  }));

  return NextResponse.json(await buildResumePayload(store, changeSet.id), { status: 201 });
}
