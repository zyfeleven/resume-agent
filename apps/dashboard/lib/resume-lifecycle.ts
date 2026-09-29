import type { ClaimGuardReport, DocumentBuildReport, Fact, ResumeChangeSet, ResumeIR, ResumeVersion } from "@resume-agent/contracts";
import { documentBuildReportPassesDownloadGate } from "@resume-agent/document-build";
import { TransitionError, createResumeMachineState, transitionResume } from "@resume-agent/domain";

import { resumeItems } from "./resume-items";

/**
 * Phase 1 replays the resume state machine from `draft` on every request instead of
 * persisting its internals, because the durable truth is the stored approval and build
 * record. What the machine contributes here is its guards: a transition that should not
 * be allowed throws, and the caller turns that into a refusal.
 */
export interface LifecycleContext {
  resumeVersionId: string;
  approvedContentHash: string;
  changeSetId: string;
  changeSet: ResumeChangeSet;
  deterministicGuard: ClaimGuardReport;
  semanticGuard: ClaimGuardReport;
  resume: ResumeIR;
  facts: readonly Fact[];
  occurredAt: string;
}

export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleError";
  }
}

/** Every line in the approved resume cites at least one fact. */
function allClaimsFactBacked(resume: ResumeIR): boolean {
  return resumeItems(resume).every(({ item }) => item.factIds.length > 0);
}

/** Every fact the approved resume rests on is still verified. */
function allFactsVerified(resume: ResumeIR, facts: readonly Fact[]): boolean {
  const verified = new Set(facts.filter((fact) => fact.status === "verified").map((fact) => fact.id));
  const cited = [
    ...resume.headerFactIds,
    ...resumeItems(resume).flatMap(({ item }) => item.factIds),
    ...resume.experience.flatMap((entry) => [entry.roleFactId, entry.organizationFactId, ...entry.dateFactIds]),
  ];
  return cited.every((factId) => verified.has(factId));
}

function run<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof TransitionError) {
      throw new LifecycleError(error.message);
    }
    throw error;
  }
}

/** Take a reviewed change set through fact-check and user approval. */
export function approveResumeContent(context: LifecycleContext): { status: ResumeVersion["status"] } {
  const state = createResumeMachineState(context.resumeVersionId, context.approvedContentHash);

  const factChecked = run(() =>
    transitionResume(
      state,
      {
        id: `${context.changeSetId}:fact-check`,
        type: "FACT_CHECK_PASSED",
        expectedRevision: 0,
        occurredAt: context.occurredAt,
      },
      {
        allClaimsFactBacked: allClaimsFactBacked(context.resume),
        allFactsVerified: allFactsVerified(context.resume, context.facts),
        deterministicClaimChecksPassed:
          context.deterministicGuard.layer === "deterministic" &&
          context.deterministicGuard.contentHash === context.approvedContentHash &&
          context.deterministicGuard.passed,
        semanticClaimChecksPassed:
          context.semanticGuard.layer === "semantic" &&
          context.semanticGuard.contentHash === context.approvedContentHash &&
          context.semanticGuard.passed,
      },
    ),
  );

  const approved = run(() =>
    transitionResume(
      factChecked.state,
      {
        id: `${context.changeSetId}:approve`,
        type: "USER_APPROVED",
        expectedRevision: 1,
        occurredAt: context.occurredAt,
        changeSetId: context.changeSetId,
        approvedContentHash: context.approvedContentHash,
      },
      {
        approvalPersisted: true,
        approvalContentHash: context.approvedContentHash,
        approvalChangeSetId: context.changeSetId,
      },
    ),
  );

  return { status: approved.state.status };
}

/** Take an approved resume through a verified document build. */
export function recordDocumentBuild(
  context: LifecycleContext & {
    artifactId: string;
    artifactHash: string;
    manifestArtifactId: string;
    buildReport: DocumentBuildReport;
  },
): { status: ResumeVersion["status"] } {
  const state = createResumeMachineState(context.resumeVersionId, context.approvedContentHash);

  const factChecked = run(() =>
    transitionResume(
      state,
      { id: `${context.changeSetId}:fact-check`, type: "FACT_CHECK_PASSED", expectedRevision: 0, occurredAt: context.occurredAt },
      {
        allClaimsFactBacked: allClaimsFactBacked(context.resume),
        allFactsVerified: allFactsVerified(context.resume, context.facts),
        deterministicClaimChecksPassed:
          context.deterministicGuard.layer === "deterministic" &&
          context.deterministicGuard.contentHash === context.approvedContentHash &&
          context.deterministicGuard.passed,
        semanticClaimChecksPassed:
          context.semanticGuard.layer === "semantic" &&
          context.semanticGuard.contentHash === context.approvedContentHash &&
          context.semanticGuard.passed,
      },
    ),
  );

  const approved = run(() =>
    transitionResume(
      factChecked.state,
      {
        id: `${context.changeSetId}:approve`,
        type: "USER_APPROVED",
        expectedRevision: 1,
        occurredAt: context.occurredAt,
        changeSetId: context.changeSetId,
        approvedContentHash: context.approvedContentHash,
      },
      {
        approvalPersisted: true,
        approvalContentHash: context.approvedContentHash,
        approvalChangeSetId: context.changeSetId,
      },
    ),
  );

  const built = run(() =>
    transitionResume(
      approved.state,
      {
        id: `${context.artifactHash}:docx-built`,
        type: "DOCX_BUILT",
        expectedRevision: 2,
        occurredAt: context.occurredAt,
        artifactId: context.artifactId,
        artifactHash: context.artifactHash,
        manifestArtifactId: context.manifestArtifactId,
        sourceContentHash: context.approvedContentHash,
      },
      { manifestPersisted: true, manifestMatchesInputs: documentBuildReportPassesDownloadGate(context.buildReport) },
    ),
  );

  return { status: built.state.status };
}
