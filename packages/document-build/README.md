# Document Build

`@resume-agent/document-build` writes an approved resume to a `.docx` and checks the result against the content that was approved.

## Guarantees

- The builder is pure and deterministic: no clock, randomness, network, or model call. Identical approved content and template produce byte-identical output, including a fixed archive timestamp.
- `template:classic-single-column` is an immutable, versioned OOXML template with explicit Arial typography, real paragraph styles, real Word bullet numbering, section rules, spacing, and Letter page geometry. It uses one ATS-safe column and no tables, text boxes, images, or floating shapes.
- Only `verified` facts reach the page. A pending or rejected fact is invisible to the layout.
- Every paragraph records the facts its text came from. The contract's one-fact minimum on a block makes an unattributable line unrepresentable.
- The output is bound to the approval it came from: the approved content and presentation hashes, change set, verified-fact snapshot, and template ID/version/hash all travel with the build record.

## Why not `DocumentBuildManifest`

The `DocumentBuildManifest` contract records **editing a user-supplied DOCX in place**: it binds a source artifact, inspection profile, block-level operations, and tracked-changes presentation. The built-in classic template has no external source artifact or tracked-change operations, so `ResumeDocumentBuild` remains the narrower record and carries the immutable template fingerprint itself.

## Verification

`verifyDocumentBuild` re-reads the bytes that were written rather than trusting the builder's report of what it wrote. It requires five non-skippable delivery gates: canonical package safety, metadata/privacy, ATS-safe structure, a complete page render, and full-page visual regression inspection. A build that fails or lacks evidence is stored with its failures and is never served for download.

The first three gates inspect the exact DOCX bytes. The ZIP reader validates local and central records, CRC-32, entry names, duplicates, bounds, and the fixed package shape. The OOXML audit rejects external relationships, active content, embedded packages, unsafe field codes, review history, comments, hidden text, revision IDs, custom XML, metadata parts, and unsupported layout objects.

The last two gates accept only `DocumentRenderEvidence` from a trusted local renderer. Evidence binds the build ID, output hash, template hash, continuous page set, page image hashes, dimensions, DPI, visual baseline, comparison hash, and inspection result. Every page must explicitly show no clipping, overlap, missing glyphs, font fallback, bullet misalignment, unexpected break, or blank page. Evidence is revalidated again immediately before download.

The dashboard never accepts this evidence from a browser request. By default, the Node.js build route invokes a trusted local worker: LibreOffice renders the exact DOCX to PDF, Poppler rasterizes every page and reports page text, geometry, and fonts, and the worker checks clipping, overlap, missing text/glyphs, Arial fallback, bullet alignment, stranded section headings, and blank pages. It hashes the actual page PNGs and stores the resulting evidence inside the build report. Missing software or any failed inspection leaves the render and visual gates blocked.

An operator can still deposit independently reviewed evidence as `<output-sha256>.json` in the private directory configured by `RESUME_AGENT_DOCX_QA_EVIDENCE_DIR`; valid deposited evidence takes precedence. Missing, malformed, stale, or replayed evidence is ignored. Browser requests cannot select a file or provide evidence.

### Local renderer prerequisites

- LibreOffice (`soffice.com` on Windows)
- Poppler executables: `pdftoppm`, `pdftotext`, and `pdffonts`

The worker discovers normal Windows installations and executables on `PATH`. Non-standard installations can be configured with `RESUME_AGENT_LIBREOFFICE_PATH`, `RESUME_AGENT_PDFTOPPM_PATH`, `RESUME_AGENT_PDFTOTEXT_PATH`, and `RESUME_AGENT_PDFFONTS_PATH`. These variables name trusted local executables; they are never accepted from an HTTP request.

| Failure | Meaning |
|---|---|
| `output_hash_mismatch` | The stored bytes are not the bytes that were built. |
| `template_mismatch` | The approval, build record, styles, numbering, or page geometry does not match the cited template version. |
| `approval_content_mismatch` | The document was built from different approved content than the approval it cites. |
| `change_set_mismatch` | The document cites a change set other than the one it was built from. |
| `block_not_fact_backed` | A block cites a fact that is not a verified fact of this profile. |
| `block_text_not_in_document` | The build record claims a line the document does not contain. |
| `document_text_mismatch` | The document's text is not the text recorded at build time. |
| `unapproved_text_in_document` | The document contains a line no recorded block accounts for. |
| `package_safety_failed` | ZIP integrity, package limits, relationships, or active-content checks failed. |
| `privacy_metadata_failed` | Metadata, comments, tracked changes, hidden text, revision IDs, or other privacy residue remains. |
| `structure_failed` | Required OOXML parts, styles, numbering, relationships, or ATS-safe layout structure is missing. |
| `render_evidence_missing` | No trusted full-page render evidence exists for these bytes. |
| `render_evidence_mismatch` | Render evidence is incomplete, altered, or belongs to different bytes or a different template. |
| `visual_quality_failed` | At least one rendered page failed baseline comparison or full-page defect inspection. |

## The package writer

The ZIP writer stores entries uncompressed. That keeps it small enough to audit line by line and keeps output deterministic — a compressor's version or heuristics would otherwise leak into a hash that later gates approval. The reader accepts only canonical stored entries and validates the entire central directory, so an archive from elsewhere is rejected rather than silently half-read.

Output is verified against an independent OOXML parser in the test suite, not only against this package's own reader.

## Reproducible artifact manifests

Every QA-approved downloadable DOCX receives a `resume-artifact-manifest-v1` record and JSON artifact. It binds the exact output and semantic-text hashes to the resume version, approved content, change set, base/result content, fact and requirement snapshots, approval digest, presentation digest, template ID/version/hash, builder and verifier versions, render evidence, and all five QA evidence hashes.

`createResumeArtifactManifest` is deterministic for the same build inputs. `verifyResumeArtifactManifest` reconstructs the expected record and compares every field and the canonical manifest digest. The dashboard repeats this verification before serving either the DOCX or its manifest; old builds without a valid manifest fail closed.
