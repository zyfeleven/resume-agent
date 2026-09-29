import { DocumentRenderEvidenceSchema, type ResumeDocumentBuild } from "@resume-agent/contracts";
import { renderResumeDocumentEvidence } from "@resume-agent/document-build";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Load evidence deposited by the trusted local renderer. Browser requests cannot name
 * or supply this file; the operator configures one private directory and evidence is
 * selected solely by the immutable output hash.
 */
export function readTrustedDocumentRenderEvidence(build: ResumeDocumentBuild) {
  const directory = process.env.RESUME_AGENT_DOCX_QA_EVIDENCE_DIR;
  if (!directory) return undefined;

  try {
    const value: unknown = JSON.parse(readFileSync(path.join(directory, `${build.outputHash}.json`), "utf8"));
    return DocumentRenderEvidenceSchema.parse(value);
  } catch {
    // Missing, malformed, stale, or tampered evidence fails closed in the verifier.
    return undefined;
  }
}

/**
 * Prefer operator-deposited evidence, then run the trusted local renderer. Renderer
 * failures return no evidence so the existing download gate remains fail-closed.
 */
export function readOrCreateTrustedDocumentRenderEvidence(
  build: ResumeDocumentBuild,
  bytes: Uint8Array,
  renderedAt: string,
) {
  const deposited = readTrustedDocumentRenderEvidence(build);
  if (deposited) return deposited;

  try {
    return renderResumeDocumentEvidence({ build, bytes, renderedAt });
  } catch (error) {
    console.warn(
      "Trusted local DOCX rendering did not complete; download remains blocked.",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}
