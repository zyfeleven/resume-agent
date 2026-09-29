import {
  ResumeContentApprovalSchema,
  ResumeVersionSchema,
  type ClaimViolation,
} from "@resume-agent/contracts";
import { applyReviewedChanges, checkChangeSetClaims, checkSemanticClaims } from "@resume-agent/resume-tailor";
import { NextResponse } from "next/server";

import { recordAuditEvent } from "../../../../lib/audit-store";
import { z } from "zod";

import { readJobStore } from "../../../../lib/job-store";
import {
  LOCAL_PROFILE_ID,
  LOCAL_REVIEWER_ID,
  readProfileStore,
  usableProfileFacts,
} from "../../../../lib/profile-store";
import { LifecycleError, approveResumeContent } from "../../../../lib/resume-lifecycle";
import { approvedResumeVersionId, resumeContentApprovalId } from "../../../../lib/resume-identity";
import { buildResumePayload } from "../../../../lib/resume-view";
import { DEFAULT_TEMPLATE_ID, updateResumeStore } from "../../../../lib/resume-store";
import { hashJson } from "../../../../lib/hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ApproveSchema = z.object({ changeSetId: z.string().min(1).max(128) }).strict();

class ApprovalRefused extends Error {
  constructor(message: string, readonly violations: ClaimViolation[] = []) {
    super(message);
  }
}

/**
 * Approve the reviewed resume content.
 *
 * Approval is the gate between a proposal and a document. It is refused while any change
 * is undecided or the claim guard is failing, and the resume state machine independently
 * re-checks that every line is fact-backed and every cited fact is still verified.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Send a JSON body with a changeSetId." }, { status: 400 });
  }

  const parsed = ApproveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", message: "Choose a change set to approve." }, { status: 400 });
  }

  const [profile, jobStore] = await Promise.all([readProfileStore(), readJobStore()]);
  const facts = usableProfileFacts(profile);
  const decidedAt = new Date().toISOString();

  try {
    const store = await updateResumeStore((current) => {
      const changeSet = current.changeSets.find((entry) => entry.id === parsed.data.changeSetId);
      const baseVersion = current.versions.find((version) => version.id === changeSet?.baseResumeVersionId);

      if (!changeSet || !baseVersion) {
        throw new ApprovalRefused("That change set is not stored locally. Generate it again.");
      }

      const reviews = current.reviews.filter((review) => review.changeSetId === changeSet.id);
      const sentenceReviews = current.sentenceReviews.filter((review) => review.changeSetId === changeSet.id);
      const applied = applyReviewedChanges(baseVersion.resume, changeSet, reviews, sentenceReviews);
      if (applied.pendingChangeIds.length > 0) {
        throw new ApprovalRefused(
          `${applied.pendingChangeIds.length} change(s) are still unreviewed. Decide every change before approving.`,
        );
      }

      // Re-run both guards over the exact reviewed wording. Stored generation-time
      // reports are evidence, not authority: facts, requirements, or sentence choices
      // may have changed since the proposal was created.
      const requirements = jobStore.requirements.filter((requirement) => requirement.jobId === changeSet.jobId);
      const guard = checkChangeSetClaims({
        changeSet,
        baseResume: baseVersion.resume,
        finalizedResume: applied.resume,
        facts,
        requirements,
        checkedAt: decidedAt,
      });
      const semanticGuard = checkSemanticClaims({
        changeSet,
        baseResume: baseVersion.resume,
        finalizedResume: applied.resume,
        facts,
        requirements,
        checkedAt: decidedAt,
      });
      if (!guard.passed || !semanticGuard.passed) {
        const failed = [!guard.passed ? "deterministic" : null, !semanticGuard.passed ? "semantic" : null]
          .filter(Boolean)
          .join(" and ");
        const violations = [...guard.violations, ...semanticGuard.violations];
        throw new ApprovalRefused(
          `The ${failed} claim guard is failing for the reviewed wording. ${violations[0]?.detail ?? "Regenerate and review it again."}`,
          violations,
        );
      }

      const approvedContentHash = applied.contentHash;
      const resumeVersionId = approvedResumeVersionId(changeSet.id, approvedContentHash);

      // The state machine re-checks fact backing, verification, and both claim guards.
      const { status } = approveResumeContent({
        resumeVersionId,
        approvedContentHash,
        changeSetId: changeSet.id,
        changeSet,
        deterministicGuard: guard,
        semanticGuard,
        resume: applied.resume,
        facts,
        occurredAt: decidedAt,
      });

      const approval = ResumeContentApprovalSchema.parse({
        id: resumeContentApprovalId(changeSet.id, approvedContentHash),
        resumeVersionId,
        profileId: LOCAL_PROFILE_ID,
        jobId: changeSet.jobId,
        changeSetId: changeSet.id,
        changeSetHash: changeSet.contentHash,
        approvedContentHash,
        // Approval binds the exact content to the one supported presentation template.
        approvedPresentationHash: hashJson([DEFAULT_TEMPLATE_ID, approvedContentHash]),
        decidedBy: LOCAL_REVIEWER_ID,
        decidedAt,
      });

      const version = ResumeVersionSchema.parse({
        id: resumeVersionId,
        profileId: LOCAL_PROFILE_ID,
        jobId: changeSet.jobId,
        parentVersionId: baseVersion.id,
        templateId: DEFAULT_TEMPLATE_ID,
        resume: applied.resume,
        changeSetId: changeSet.id,
        status,
        contentHash: approvedContentHash,
        createdAt: decidedAt,
        updatedAt: decidedAt,
      });

      return {
        ...current,
        activeResumeVersionId: version.id,
        versions: [...current.versions.filter((entry) => entry.id !== version.id), version],
        approvals: [...current.approvals.filter((entry) => entry.id !== approval.id), approval],
        guardReports: [...current.guardReports.filter((entry) => entry.changeSetId !== changeSet.id), guard],
        semanticGuardReports: [
          ...current.semanticGuardReports.filter((entry) => entry.changeSetId !== changeSet.id),
          semanticGuard,
        ],
      };
    });

    const approved = store.approvals.at(-1);
    await recordAuditEvent({
      actorType: "user",
      actorId: LOCAL_REVIEWER_ID,
      eventType: "resume.content_approved",
      payload: {
        changeSetId: parsed.data.changeSetId,
        ...(approved ? { approvalId: approved.id, approvedContentHash: approved.approvedContentHash } : {}),
      },
    });

    return NextResponse.json(await buildResumePayload(store, parsed.data.changeSetId, { profile, jobStore }), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof ApprovalRefused) {
      return NextResponse.json(
        { error: "approval_refused", message: error.message, violations: error.violations },
        { status: 409 },
      );
    }
    if (error instanceof LifecycleError) {
      return NextResponse.json({ error: "approval_refused", message: error.message }, { status: 409 });
    }
    throw error;
  }
}
