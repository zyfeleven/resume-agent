import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ZodType } from "zod";

/**
 * Phase 1 keeps imported candidate data in local JSON files next to the dashboard.
 * This is deliberately not a database: one local user, no encryption, Git-ignored, and
 * deletable in full from the UI. Encrypted storage, retention windows, and access
 * control are Phase 5 release gates.
 */
export type ArtifactScope = "resumes" | "jobs";

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

  const read = async (): Promise<T> => {
    let raw: string;
    try {
      raw = await readFile(file(), "utf8");
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
    read,

    async update(mutate) {
      return serialize(async () => {
        const next = options.schema.parse(await mutate(await read()));

        await mkdir(dataDirectory(), { recursive: true });
        const target = file();
        const temporary = `${target}.tmp`;
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        await rename(temporary, target);

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
  const directory = artifactDirectory(scope);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), bytes);
}
