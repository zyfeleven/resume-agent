import { ArtifactSchema, type ClaimViolation } from "@resume-agent/contracts";
import {
  buildResumeDocument,
  createResumeArtifactManifest,
  serializeResumeArtifactManifest,
  verifyDocumentBuild,
} from "@resume-agent/document-build";
import { checkChangeSetClaims, checkSemanticClaims } from "@resume-agent/resume-tailor";
import { NextResponse } from "next/server";

import { recordAuditEvent } from "../../../../lib/audit-store";
import { z } from "zod";

import { documentFileName } from "../../../../lib/document-name";
import { readOrCreateTrustedDocumentRenderEvidence } from "../../../../lib/document-quality-evidence";
import { readJobStore } from "../../../../lib/job-store";
import { writeArtifactFile } from "../../../../lib/local-store";
import { LOCAL_PROFILE_ID, readProfileStore, usableProfileFacts } from "../../../../lib/profile-store";
import { LifecycleError, recordDocumentBuild } from "../../../../lib/resume-lifecycle";
import { buildResumePayload } from "../../../../lib/resume-view";
import { DEFAULT_TEMPLATE_ID, updateResumeStore } from "../../../../lib/resume-store";
import { hashBytes } from "../../../../lib/hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BuildSchema = z.object({ changeSetId: z.string().min(1).max(128) }).strict();

class BuildRefused extends Error {
  constructor(message: string, readonly violations: ClaimViolation[] = []) {
    super(message);
  }
}

/**
 * Build the approved resume into a DOCX.
 *
 * The document is written, then read back and checked against the approval it came from.
 * A build that fails verification is stored with its failures and is never offered for
 * download, so a document that does not match approved content cannot leave this machine.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Send a JSON body with a changeSetId." }, { status: 400 });
  }

  const parsed = BuildSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", message: "Choose a change set to build." }, { status: 400 });
  }

  const [profile, jobStore] = await Promise.all([readProfileStore(), readJobStore()]);
  const facts = usableProfileFacts(profile);
  const builtAt = new Date().toISOString();
  let writtenFiles: Array<{ name: string; bytes: Uint8Array }> = [];

  try {
    const store = await updateResumeStore((current) => {
      const changeSet = current.changeSets.find((entry) => entry.id === parsed.data.changeSetId);
      const approval = [...current.approvals]
        .filter((entry) => entry.changeSetId === parsed.data.changeSetId)
        .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0];

      if (!changeSet) {
        throw new BuildRefused("That change set is not stored locally. Generate it again.");
      }
      if (!approval) {
        throw new BuildRefused("Approve the reviewed content before building a document.");
      }

      const version = current.versions.find((entry) => entry.id === approval.resumeVersionId);
      if (!version) {
        throw new BuildRefused("The approved resume version is no longer stored. Approve it again.");
      }
      if (version.contentHash !== approval.approvedContentHash) {
        throw new BuildRefused("The stored resume version does not match its approval. Approve it again.");
      }
      const baseVersion = current.versions.find((entry) => entry.id === changeSet.baseResumeVersionId);
      if (!baseVersion) {
        throw new BuildRefused("The base resume behind this approval is no longer stored. Generate it again.");
      }

      const requirements = jobStore.requirements.filter((requirement) => requirement.jobId === changeSet.jobId);
      const guard = checkChangeSetClaims({
        changeSet,
        baseResume: baseVersion.resume,
        finalizedResume: version.resume,
        facts,
        requirements,
        checkedAt: builtAt,
      });
      const semanticGuard = checkSemanticClaims({
        changeSet,
        baseResume: baseVersion.resume,
        finalizedResume: version.resume,
        facts,
        requirements,
        checkedAt: builtAt,
      });
      if (!guard.passed || !semanticGuard.passed) {
        const violations = [...guard.violations, ...semanticGuard.violations];
        throw new BuildRefused(
          `The approved wording no longer passes both claim guards. ${violations[0]?.detail ?? "Approve it again."}`,
          violations,
        );
      }

      let document: ReturnType<typeof buildResumeDocument>;
      try {
        document = buildResumeDocument({
          resumeVersionId: version.id,
          profileId: LOCAL_PROFILE_ID,
          ...(changeSet.jobId === undefined ? {} : { jobId: changeSet.jobId }),
          templateId: DEFAULT_TEMPLATE_ID,
          resume: version.resume,
          facts,
          changeSet,
          approval,
          builtAt,
        });
      } catch (error) {
        throw new BuildRefused(
          error instanceof Error ? error.message : "The approved content could not be applied to its template.",
        );
      }
      const { build, bytes } = document;
      const renderEvidence = readOrCreateTrustedDocumentRenderEvidence(build, bytes, builtAt);

      const report = verifyDocumentBuild({
        build,
        bytes,
        resume: version.resume,
        facts,
        changeSet,
        approval,
        ...(renderEvidence === undefined ? {} : { renderEvidence }),
        checkedAt: builtAt,
      });
      const manifest = report.passed
        ? createResumeArtifactManifest({ build, report, approval, changeSet, createdAt: builtAt })
        : null;

      // Failed QA remains stored for diagnosis, but only a report with every P2-06 gate
      // can advance the lifecycle to `docx_built`.
      const status = report.passed
        ? recordDocumentBuild({
            resumeVersionId: version.id,
            approvedContentHash: approval.approvedContentHash,
            changeSetId: changeSet.id,
            changeSet,
            deterministicGuard: guard,
            semanticGuard,
            resume: version.resume,
            facts,
            occurredAt: builtAt,
            artifactId: build.outputArtifactId,
            artifactHash: build.outputHash,
            manifestArtifactId: manifest?.manifestArtifactId ?? build.id,
            buildReport: report,
          }).status
        : version.status;

      const storedFileName = `${build.outputHash}.docx`;
      writtenFiles = [{ name: storedFileName, bytes }];

      const artifact = ArtifactSchema.parse({
        id: build.outputArtifactId,
        kind: "tailored_resume",
        fileName: documentFileName(jobStore.jobs.find((entry) => entry.id === changeSet.jobId)),
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        contentHash: build.outputHash,
        byteSize: build.outputByteSize,
        storageKey: `local:${storedFileName}`,
        sensitivity: "pii",
        createdAt: builtAt,
      });
      let manifestArtifact = null;
      if (manifest) {
        const manifestBytes = serializeResumeArtifactManifest(manifest);
        const manifestFileHash = hashBytes(manifestBytes);
        const manifestStoredFileName = `${manifestFileHash}.json`;
        writtenFiles.push({ name: manifestStoredFileName, bytes: manifestBytes });
        manifestArtifact = ArtifactSchema.parse({
          id: manifest.manifestArtifactId,
          kind: "manifest",
          fileName: artifact.fileName.replace(/\.docx$/i, ".manifest.json"),
          mediaType: "application/json",
          contentHash: manifestFileHash,
          byteSize: manifestBytes.byteLength,
          storageKey: `local:${manifestStoredFileName}`,
          sensitivity: "normal",
          createdAt: builtAt,
        });
      }

      return {
        ...current,
        versions: current.versions.map((entry) =>
          entry.id === version.id ? { ...entry, status, updatedAt: builtAt } : entry,
        ),
        builds: [...current.builds.filter((entry) => entry.id !== build.id), build],
        guardReports: [...current.guardReports.filter((entry) => entry.changeSetId !== changeSet.id), guard],
        semanticGuardReports: [
          ...current.semanticGuardReports.filter((entry) => entry.changeSetId !== changeSet.id),
          semanticGuard,
        ],
        buildReports: [...current.buildReports.filter((entry) => entry.buildId !== build.id), report],
        artifactManifests: manifest
          ? [...current.artifactManifests.filter((entry) => entry.buildId !== build.id), manifest]
          : current.artifactManifests.filter((entry) => entry.buildId !== build.id),
        artifacts: [
          ...current.artifacts.filter(
            (entry) => entry.id !== artifact.id && entry.id !== manifestArtifact?.id,
          ),
          artifact,
          ...(manifestArtifact ? [manifestArtifact] : []),
        ],
      };
    });

    for (const { name, bytes } of writtenFiles) {
      await writeArtifactFile("documents", name, bytes);
    }

    const record = store.builds.at(-1);
    const verification = store.buildReports.find((entry) => entry.buildId === record?.id);
    const manifestRecord = store.artifactManifests.find((entry) => entry.buildId === record?.id);
    await recordAuditEvent({
      actorType: "service",
      actorId: "document-builder:local",
      eventType: "resume.document_built",
      payload: {
        changeSetId: parsed.data.changeSetId,
        ...(record
          ? {
              buildId: record.id,
              outputHash: record.outputHash,
              blockCount: record.blocks.length,
              ...(manifestRecord ? { manifestId: manifestRecord.id } : {}),
            }
          : {}),
        verified: verification?.passed ?? false,
        ...(verification && !verification.passed
          ? { failures: verification.failures.map((failure) => failure.code) }
          : {}),
      },
    });

    return NextResponse.json(await buildResumePayload(store, parsed.data.changeSetId, { profile, jobStore }), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof BuildRefused) {
      return NextResponse.json(
        { error: "build_refused", message: error.message, violations: error.violations },
        { status: 409 },
      );
    }
    if (error instanceof LifecycleError) {
      return NextResponse.json({ error: "build_refused", message: error.message }, { status: 409 });
    }
    throw error;
  }
}
