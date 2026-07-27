import { ArtifactSchema, CandidateProfileSchema } from "@resume-agent/contracts";
import { extractResumeFacts, mergeImportedFacts } from "@resume-agent/resume-import";
import { NextResponse } from "next/server";

import { writeArtifactFile } from "../../../../lib/local-store";
import { toProfilePayload } from "../../../../lib/profile-payload";
import { LOCAL_PROFILE_ID, updateProfileStore, type ProfileStore } from "../../../../lib/profile-store";
import { ResumeSourceError, readResumeSource } from "../../../../lib/resume-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function displayNameFrom(store: ProfileStore): string {
  const name = store.facts.find((fact) => fact.key === "full_name" && fact.status !== "rejected");
  return typeof name?.value === "string" && name.value.length > 0 ? name.value : "Local candidate";
}

/**
 * Import one master resume.
 *
 * Extraction is deterministic and produces only pending facts: nothing imported here is
 * usable by resume tailoring or form filling until the user verifies it in the review list.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Send the resume as multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_request", message: "Attach one resume file named `file`." }, { status: 400 });
  }

  let source;
  try {
    source = await readResumeSource(file);
  } catch (error) {
    if (error instanceof ResumeSourceError) {
      return NextResponse.json({ error: "unsupported_source", message: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "parse_failed", message: "This file could not be read as a resume document." },
      { status: 400 },
    );
  }

  const importedAt = new Date().toISOString();
  const { facts, report } = extractResumeFacts({
    profileId: LOCAL_PROFILE_ID,
    source: {
      artifactId: source.artifactId,
      fileName: source.fileName,
      format: source.format,
      contentHash: source.contentHash,
      byteSize: source.byteSize,
    },
    text: source.text,
    importedAt,
  });

  await writeArtifactFile("resumes", source.storedFileName, source.bytes);

  const store = await updateProfileStore((current) => {
    const merged = mergeImportedFacts(current.facts, facts);
    const artifact = ArtifactSchema.parse({
      id: source.artifactId,
      kind: "source_resume",
      fileName: source.fileName,
      mediaType: source.mediaType,
      contentHash: source.contentHash,
      byteSize: source.byteSize,
      storageKey: `local:${source.storedFileName}`,
      sensitivity: "pii",
      createdAt: importedAt,
    });

    const profile = CandidateProfileSchema.parse({
      id: LOCAL_PROFILE_ID,
      displayName: displayNameFrom({ ...current, facts: merged.facts }),
      factIds: merged.facts.map((fact) => fact.id),
      version: (current.profile?.version ?? 0) + 1,
      createdAt: current.profile?.createdAt ?? importedAt,
      updatedAt: importedAt,
    });

    return {
      ...current,
      profile,
      facts: merged.facts,
      artifacts: [...current.artifacts.filter((entry) => entry.id !== artifact.id), artifact],
      imports: [...current.imports.filter((entry) => entry.id !== report.id), report],
    };
  });

  return NextResponse.json(toProfilePayload(store), { status: 201 });
}
