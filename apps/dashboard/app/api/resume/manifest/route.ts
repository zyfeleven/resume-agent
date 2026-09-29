import { ResumeArtifactManifestSchema } from "@resume-agent/contracts";
import { verifyResumeArtifactManifest } from "@resume-agent/document-build";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { hashBytes } from "../../../../lib/hash";
import { artifactDirectory } from "../../../../lib/local-store";
import { readResumeStore } from "../../../../lib/resume-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const buildId = new URL(request.url).searchParams.get("buildId");
  if (!buildId) {
    return NextResponse.json({ error: "invalid_request", message: "Name the build manifest to download." }, { status: 400 });
  }

  const store = await readResumeStore();
  const build = store.builds.find((entry) => entry.id === buildId);
  const report = store.buildReports.find((entry) => entry.buildId === buildId);
  const manifest = store.artifactManifests.find((entry) => entry.buildId === buildId);
  const approval = store.approvals.find((entry) => entry.id === build?.contentApprovalId);
  const changeSet = store.changeSets.find((entry) => entry.id === build?.changeSetId);
  if (!build || !report || !manifest || !approval || !changeSet) {
    return NextResponse.json({ error: "not_found", message: "That artifact manifest is not stored locally." }, { status: 404 });
  }
  if (!verifyResumeArtifactManifest({ manifest, build, report, approval, changeSet })) {
    return NextResponse.json({ error: "manifest_verification_failed", message: "The artifact manifest failed lineage verification." }, { status: 409 });
  }

  const artifact = store.artifacts.find((entry) => entry.id === manifest.manifestArtifactId);
  const storageName = artifact?.storageKey.startsWith("local:") ? artifact.storageKey.slice("local:".length) : "";
  if (
    !artifact ||
    !storageName ||
    storageName === "." ||
    storageName === ".." ||
    path.isAbsolute(storageName) ||
    path.posix.basename(storageName) !== storageName ||
    path.win32.basename(storageName) !== storageName
  ) {
    return NextResponse.json({ error: "not_found", message: "The stored manifest file is missing." }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(artifactDirectory("documents"), storageName));
  } catch {
    return NextResponse.json({ error: "not_found", message: "The stored manifest file is missing." }, { status: 404 });
  }
  let stored: unknown;
  try {
    stored = JSON.parse(bytes.toString("utf8"));
  } catch {
    stored = null;
  }
  if (
    hashBytes(bytes) !== artifact.contentHash ||
    !ResumeArtifactManifestSchema.safeParse(stored).success ||
    JSON.stringify(stored) !== JSON.stringify(manifest)
  ) {
    return NextResponse.json({ error: "hash_mismatch", message: "The stored manifest bytes no longer match its record." }, { status: 409 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${artifact.fileName}"`,
      "cache-control": "no-store",
    },
  });
}
