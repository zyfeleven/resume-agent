import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

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
  if (!report?.passed) {
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

  const artifact = store.artifacts.find((entry) => entry.id === build.outputArtifactId);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${artifact?.fileName ?? "resume.docx"}"`,
      "cache-control": "no-store",
    },
  });
}
