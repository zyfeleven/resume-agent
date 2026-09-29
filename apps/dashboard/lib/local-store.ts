import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ZodType } from "zod";
import { writeJsonAtomically } from "./atomic-json-write";

/**
 * Phase 1 keeps imported candidate data in local JSON files next to the dashboard.
 * This is deliberately not a database: one local user, no encryption, Git-ignored, and
 * deletable in full from the UI. Encrypted storage, retention windows, and access
 * control are Phase 5 release gates.
 */
export type ArtifactScope = "resumes" | "jobs" | "documents";

export function dataDirectory(): string {
  const configured = process.env.RESUME_AGENT_DATA_DIR;
  return configured && configured.length > 0 ? configured : path.join(process.cwd(), ".data");
}

export function artifactDirectory(scope: ArtifactScope): string {
  return path.join(dataDirectory(), "artifacts", scope);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

// Local single-user guard. It serializes writes across every store in this process,
// which is what a local control plane needs; a shared deployment would need a real
// transaction boundary.
let writeQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export interface JsonStore<T> {
  read(): Promise<T>;
  update(mutate: (current: T) => T | Promise<T>): Promise<T>;
  clear(): Promise<T>;
}

export function createJsonStore<T>(options: {
  fileName: string;
  schema: ZodType<T>;
  empty: () => T;
  artifactScope?: ArtifactScope;
}): JsonStore<T> {
  const file = (): string => path.join(dataDirectory(), options.fileName);

  const readAt = async (target: string): Promise<T> => {
    let raw: string;
    try {
      raw = await readFile(target, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        return options.empty();
      }
      throw error;
    }

    // A store that no longer matches its contract fails closed instead of being
    // partially trusted: reviewed decisions must never be inferred from unreadable data.
    return options.schema.parse(JSON.parse(raw));
  };

  return {
    read: () => readAt(file()),

    async update(mutate) {
      return serialize(async () => {
        // Keep this transaction on one path even if configuration changes during mutate.
        const target = path.resolve(file());
        const next = options.schema.parse(await mutate(await readAt(target)));
        await mkdir(path.dirname(target), { recursive: true });
        await writeJsonAtomically(target, `${JSON.stringify(next, null, 2)}\n`);

        return next;
      });
    },

    async clear() {
      return serialize(async () => {
        await rm(file(), { force: true });
        if (options.artifactScope) {
          await rm(artifactDirectory(options.artifactScope), { force: true, recursive: true });
        }
        return options.empty();
      });
    },
  };
}

export async function writeArtifactFile(scope: ArtifactScope, fileName: string, bytes: Uint8Array): Promise<void> {
  if (
    fileName.length === 0 ||
    fileName === "." ||
    fileName === ".." ||
    path.isAbsolute(fileName) ||
    path.posix.basename(fileName) !== fileName ||
    path.win32.basename(fileName) !== fileName ||
    /[\p{Cc}]/u.test(fileName)
  ) {
    throw new Error("Artifact file names must be plain file names without a directory path.");
  }
  const directory = artifactDirectory(scope);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), bytes);
}
