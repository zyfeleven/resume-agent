import {
  ArtifactSchema,
  CandidateProfileSchema,
  FactSchema,
  ResumeImportReportSchema,
} from "@resume-agent/contracts";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const LOCAL_PROFILE_ID = "profile:local";
export const LOCAL_REVIEWER_ID = "user:local";

/**
 * Phase 1 keeps imported facts in one local JSON file next to the dashboard.
 * It is deliberately not a database: it holds a single local profile, it is excluded
 * from Git, and it is deleted in full by the clear endpoint. Encrypted storage,
 * retention windows, and access control are Phase 5 release gates.
 */
export const ProfileStoreSchema = z
  .object({
    version: z.literal(1),
    profile: CandidateProfileSchema.nullable(),
    artifacts: z.array(ArtifactSchema),
    imports: z.array(ResumeImportReportSchema),
    facts: z.array(FactSchema),
  })
  .strict();

export type ProfileStore = z.infer<typeof ProfileStoreSchema>;

export function emptyProfileStore(): ProfileStore {
  return { version: 1, profile: null, artifacts: [], imports: [], facts: [] };
}

export function dataDirectory(): string {
  const configured = process.env.RESUME_AGENT_DATA_DIR;
  return configured && configured.length > 0 ? configured : path.join(process.cwd(), ".data");
}

export function artifactDirectory(): string {
  return path.join(dataDirectory(), "artifacts");
}

function storeFile(): string {
  return path.join(dataDirectory(), "profile-store.json");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

// Local single-user guard. It serializes writes inside this process only, which is what a
// local control plane needs; a shared deployment would need a real transaction boundary.
let writeQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function readProfileStore(): Promise<ProfileStore> {
  let raw: string;
  try {
    raw = await readFile(storeFile(), "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return emptyProfileStore();
    }
    throw error;
  }

  // A store that no longer matches the fact contract fails closed instead of being
  // partially trusted: reviewed decisions must never be inferred from unreadable data.
  return ProfileStoreSchema.parse(JSON.parse(raw));
}

export async function updateProfileStore(
  mutate: (store: ProfileStore) => ProfileStore | Promise<ProfileStore>,
): Promise<ProfileStore> {
  return serialize(async () => {
    const current = await readProfileStore();
    const next = ProfileStoreSchema.parse(await mutate(current));

    await mkdir(dataDirectory(), { recursive: true });
    const target = storeFile();
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporary, target);

    return next;
  });
}

/** Delete every locally stored fact, import report, and source resume file. */
export async function clearProfileStore(): Promise<ProfileStore> {
  return serialize(async () => {
    await rm(storeFile(), { force: true });
    await rm(artifactDirectory(), { force: true, recursive: true });
    return emptyProfileStore();
  });
}

export async function writeArtifactFile(fileName: string, bytes: Uint8Array): Promise<void> {
  await mkdir(artifactDirectory(), { recursive: true });
  await writeFile(path.join(artifactDirectory(), fileName), bytes);
}
