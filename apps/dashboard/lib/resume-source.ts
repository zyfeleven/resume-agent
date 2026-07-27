import type { ResumeSourceFormat } from "@resume-agent/contracts";
import { createHash } from "node:crypto";
import path from "node:path";

/** A master resume larger than this is refused rather than parsed. */
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export interface ResumeSourceDocument {
  artifactId: string;
  fileName: string;
  storedFileName: string;
  extension: string;
  format: ResumeSourceFormat;
  mediaType: string;
  contentHash: string;
  byteSize: number;
  text: string;
  bytes: Uint8Array;
}

export class ResumeSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeSourceError";
  }
}

const SUPPORTED_FORMATS: Record<string, { format: ResumeSourceFormat; mediaType: string }> = {
  ".docx": {
    format: "docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  ".txt": { format: "plain_text", mediaType: "text/plain" },
  ".md": { format: "markdown", mediaType: "text/markdown" },
};

function safeFileName(rawName: string): string {
  const base = path
    .basename(rawName.replace(/\\/g, "/"))
    .replace(/[\p{Cc}]/gu, "")
    .trim();

  if (base.length === 0 || base === "." || base === ".." || base.length > 500) {
    throw new ResumeSourceError("The uploaded file needs an ordinary file name.");
  }
  return base;
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const { default: mammoth } = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return result.value;
}

/**
 * Turn an uploaded file into the plain text the extractor works on.
 *
 * The dashboard never passes a local path or URL to the extractor: bytes arrive through
 * the upload, are hashed here, and only the resulting text crosses that boundary.
 */
export async function readResumeSource(file: File): Promise<ResumeSourceDocument> {
  const fileName = safeFileName(file.name);
  const extension = path.extname(fileName).toLowerCase();
  const supported = SUPPORTED_FORMATS[extension];

  if (!supported) {
    const readable = Object.keys(SUPPORTED_FORMATS).join(", ");
    throw new ResumeSourceError(
      extension === ".pdf" || extension === ".doc"
        ? `${extension} is not supported yet. Export the resume as .docx and import it again.`
        : `Import a ${readable} file.`,
    );
  }

  if (file.size > MAX_SOURCE_BYTES) {
    throw new ResumeSourceError(`This file is larger than the ${MAX_SOURCE_BYTES / 1024 / 1024} MB import limit.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new ResumeSourceError("The uploaded file is empty.");
  }

  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const text =
    supported.format === "docx" ? await extractDocxText(bytes) : new TextDecoder("utf-8").decode(bytes);

  if (text.trim().length === 0) {
    throw new ResumeSourceError("No readable text was found in this file.");
  }

  return {
    artifactId: `artifact:${contentHash.slice(0, 24)}`,
    fileName,
    storedFileName: `${contentHash}${extension}`,
    extension,
    format: supported.format,
    mediaType: supported.mediaType,
    contentHash,
    byteSize: bytes.byteLength,
    text,
    bytes,
  };
}
