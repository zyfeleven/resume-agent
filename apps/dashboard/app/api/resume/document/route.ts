import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import {
  auditDocumentPackage,
  documentBuildReportPassesDownloadGate,
  verifyResumeArtifactManifest,
  verifyDocumentRenderEvidence,
} from "@resume-agent/document-build";

import { hashBytes } from "../../../../lib/hash";
import { artifactDirectory } from "../../../../lib/local-store";
import { readResumeStore } from "../../../../lib/resume-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve a built document.
 *
 * The bytes are hashed again on the way out and refused if they no longer match the build
 * record, and a build that failed verification is never served at all.
 */
export async function GET(request: Request) {
  const buildId = new URL(request.url).searchParams.get("buildId");
  if (!buildId) {
    return NextResponse.json({ error: "invalid_request", message: "Name the build to download." }, { status: 400 });
  }

  const store = await readResumeStore();
  const build = store.builds.find((entry) => entry.id === buildId);
  if (!build) {
    return NextResponse.json({ error: "not_found", message: "That document is not stored locally." }, { status: 404 });
  }

  const report = store.buildReports.find((entry) => entry.buildId === build.id);
  const manifest = store.artifactManifests.find((entry) => entry.buildId === build.id);
  const approval = store.approvals.find((entry) => entry.id === build.contentApprovalId);
  const changeSet = store.changeSets.find((entry) => entry.id === build.changeSetId);
  if (
    !manifest ||
    !report ||
    !approval ||
    !changeSet ||
    !verifyResumeArtifactManifest({ manifest, build, report, approval, changeSet })
  ) {
    return NextResponse.json(
      { error: "manifest_verification_failed", message: "This document has no valid reproducible artifact manifest." },
      { status: 409 },
    );
  }
  if (!documentBuildReportPassesDownloadGate(report)) {
    return NextResponse.json(
      { error: "verification_failed", message: "This document did not pass verification and will not be served." },
      { status: 409 },
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(artifactDirectory("documents"), `${build.outputHash}.docx`));
  } catch {
    return NextResponse.json({ error: "not_found", message: "The stored document file is missing." }, { status: 404 });
  }

  if (hashBytes(bytes) !== build.outputHash) {
    return NextResponse.json(
      { error: "hash_mismatch", message: "The stored document no longer matches the build record." },
      { status: 409 },
    );
  }

  const packageQuality = auditDocumentPackage(bytes);
  const renderQuality = verifyDocumentRenderEvidence(build, bytes, report?.renderEvidence);
  if (packageQuality.failures.length > 0 || renderQuality.failures.length > 0) {
    return NextResponse.json(
      { error: "verification_failed", message: "The document no longer satisfies its package, privacy, render, and visual gates." },
      { status: 409 },
    );
  }

  const artifact = store.artifacts.find((entry) => entry.id === build.outputArtifactId);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${artifact?.fileName ?? "resume.docx"}"`,
      "cache-control": "no-store",
      "x-resume-manifest-hash": manifest.manifestHash,
    },
  });
}
