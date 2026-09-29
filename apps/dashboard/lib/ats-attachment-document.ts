import { readFile } from "node:fs/promises";
import path from "node:path";
import { applicationReadiness, type ReadinessInput } from "./application-readiness";
import { AtsFillPlanError } from "./ats-fill-plan";
import { readDiscoveryStore } from "./discovery-store";
import { readProfileStore } from "./profile-store";
import { readJobStore } from "./job-store";
import { readResumeStore } from "./resume-store";
import { artifactDirectory } from "./local-store";
import { hashBytes, hashJson } from "./hash";

const MAX_BYTES = 5_000_000;
/** Reuses existing document gates, without changing rendering or trusting a download URL alone.
 * The exact buffer checked by readiness is the buffer handed to the browser. */
export async function verifiedAttachmentDocument(taskId: string, input: ReadinessInput,
  readDocument: (hash: string) => Promise<Uint8Array> = hash => readFile(path.join(artifactDirectory("documents"), `${hash}.docx`))) {
  let bytes: Uint8Array | undefined;
  const readiness = await applicationReadiness(taskId, input, async hash => {
    const result = await readDocument(hash);
    if (!result.byteLength || result.byteLength > MAX_BYTES) throw new Error("Unsupported attachment size");
    bytes = Uint8Array.from(result); return bytes;
  });
  if (!readiness?.documentVerified || !readiness.downloadUrl || !bytes) throw new AtsFillPlanError("The task's current DOCX does not pass all approval, claim, manifest and rendering gates. Verify it in Resume Studio first.");
  const buildId = new URL(readiness.downloadUrl, "http://local.invalid").searchParams.get("buildId");
  const build = input.resumes.builds.find(b => b.id === buildId);
  const manifest = input.resumes.artifactManifests.find(m => m.buildId === buildId);
  if (!build || !manifest || hashBytes(bytes) !== build.outputHash || bytes.byteLength !== build.outputByteSize) throw new AtsFillPlanError("The verified document changed before attachment preparation.");
  // Deliberately conservative: local profile/JD/resume edits invalidate the prepared attachment.
  const task = input.discovery.tasks.find(t => t.id === taskId)!;
  const evidenceHash = hashJson([task, input.discovery.jobs.find(j => j.id === task.candidateId), input.profile, input.jobs, input.resumes]);
  return { bytes: Buffer.from(bytes), artifact: { buildId: build.id, outputHash: build.outputHash, byteSize: bytes.byteLength,
    manifestHash: manifest.manifestHash, evidenceHash, fileName: "resume.docx" as const, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const } };
}
export async function currentAttachmentDocument(taskId: string) {
  const [discovery, profile, jobs, resumes] = await Promise.all([readDiscoveryStore(), readProfileStore(), readJobStore(), readResumeStore()]);
  return verifiedAttachmentDocument(taskId, { discovery, profile, jobs, resumes });
}
