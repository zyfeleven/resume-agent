import { ArtifactSchema, JobSchema } from "@resume-agent/contracts";
import { mergeParsedRequirements, parseJobDescription } from "@resume-agent/jd-analysis";
import { NextResponse } from "next/server";
import { z } from "zod";

import { JdSourceError, readJdSource } from "../../../lib/jd-source";
import { toJobsPayload } from "../../../lib/job-payload";
import { clearJobStore, readJobStore, updateJobStore } from "../../../lib/job-store";
import { writeArtifactFile } from "../../../lib/local-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Title and company are supplied by the user rather than guessed from the posting.
 * The parser copies the wording of a job description; it does not infer facts about it.
 */
const JobIntakeSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    company: z.string().trim().min(1).max(240),
    location: z.string().trim().max(240).optional(),
    sourceUrl: z.string().trim().url().regex(/^https?:\/\//i).max(2_000).optional(),
    text: z.string(),
  })
  .strict();

function jobId(company: string, title: string, contentHash: string): string {
  const slug = `${company} ${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `job:${slug.length > 0 ? slug : "role"}:${contentHash.slice(0, 12)}`;
}

export async function GET() {
  return NextResponse.json(toJobsPayload(await readJobStore()));
}

/** Delete every locally stored job description, requirement, and parse report. */
export async function DELETE() {
  return NextResponse.json(toJobsPayload(await clearJobStore()));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Send a JSON job description." }, { status: 400 });
  }

  const parsed = JobIntakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "A job needs a title, a company, and the pasted description text." },
      { status: 400 },
    );
  }

  let source;
  try {
    source = readJdSource(parsed.data.text);
  } catch (error) {
    if (error instanceof JdSourceError) {
      return NextResponse.json({ error: "unsupported_source", message: error.message }, { status: 400 });
    }
    throw error;
  }

  const parsedAt = new Date().toISOString();
  const id = jobId(parsed.data.company, parsed.data.title, source.contentHash);
  const { requirements, report } = parseJobDescription({
    jobId: id,
    source: {
      artifactId: source.artifactId,
      contentHash: source.contentHash,
      byteSize: source.byteSize,
    },
    text: source.text,
    parsedAt,
  });

  await writeArtifactFile("jobs", source.storedFileName, source.bytes);

  const store = await updateJobStore((current) => {
    const existing = current.jobs.find((entry) => entry.id === id);
    const job = JobSchema.parse({
      id,
      title: parsed.data.title.trim(),
      company: parsed.data.company.trim(),
      ...(parsed.data.location ? { location: parsed.data.location.trim() } : {}),
      ...(parsed.data.sourceUrl ? { sourceUrl: parsed.data.sourceUrl.trim() } : {}),
      descriptionArtifactId: source.artifactId,
      descriptionHash: source.contentHash,
      status: existing?.status ?? "draft",
      createdAt: existing?.createdAt ?? parsedAt,
      updatedAt: parsedAt,
    });

    const artifact = ArtifactSchema.parse({
      id: source.artifactId,
      kind: "job_description",
      fileName: `${id.replace(/[^A-Za-z0-9._-]/g, "-")}.txt`,
      mediaType: "text/plain",
      contentHash: source.contentHash,
      byteSize: source.byteSize,
      storageKey: `local:${source.storedFileName}`,
      sensitivity: "normal",
      createdAt: parsedAt,
    });

    // The new parse decides which requirements exist, but corrections already made to a
    // surviving requirement are kept. A dismissed line returns if the posting still
    // contains it, so a dismissal is always recoverable by parsing again.
    const merged = mergeParsedRequirements(
      current.requirements.filter((entry) => entry.jobId === id),
      requirements,
    );

    return {
      ...current,
      jobs: [...current.jobs.filter((entry) => entry.id !== id), job],
      artifacts: [...current.artifacts.filter((entry) => entry.id !== artifact.id), artifact],
      reports: [...current.reports.filter((entry) => entry.id !== report.id), report],
      requirements: [...current.requirements.filter((entry) => entry.jobId !== id), ...merged.requirements],
    };
  });

  return NextResponse.json(toJobsPayload(store), { status: 201 });
}
