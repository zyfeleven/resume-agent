import { createHash } from "node:crypto";

/** A pasted job description larger than this is refused rather than parsed. */
export const MAX_JD_BYTES = 200_000;

export interface JdSourceDocument {
  artifactId: string;
  storedFileName: string;
  contentHash: string;
  byteSize: number;
  text: string;
  bytes: Uint8Array;
}

export class JdSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JdSourceError";
  }
}

/**
 * Normalize pasted job description text into a hashed, storable artifact.
 *
 * The text is treated as untrusted input from the moment it arrives: it is stored and
 * hashed as data, and nothing here interprets it.
 */
export function readJdSource(rawText: unknown): JdSourceDocument {
  if (typeof rawText !== "string") {
    throw new JdSourceError("Paste the job description text.");
  }

  const text = rawText.replace(/\r\n?/g, "\n").trim();
  if (text.length === 0) {
    throw new JdSourceError("Paste the job description text.");
  }

  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_JD_BYTES) {
    throw new JdSourceError(`This job description is larger than the ${MAX_JD_BYTES / 1000} KB limit.`);
  }

  const contentHash = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: `artifact:${contentHash.slice(0, 24)}`,
    storedFileName: `${contentHash}.txt`,
    contentHash,
    byteSize: bytes.byteLength,
    text,
    bytes,
  };
}
