# Document Build

`@resume-agent/document-build` writes an approved resume to a `.docx` and checks the result against the content that was approved.

## Guarantees

- The builder is pure and deterministic: no clock, no randomness, no network, no model call, and no template. Identical input produces byte-identical output, including a fixed archive timestamp, so a document hash never depends on when or where the build ran.
- Only `verified` facts reach the page. A pending or rejected fact is invisible to the layout.
- Every paragraph records the facts its text came from. The contract's one-fact minimum on a block makes an unattributable line unrepresentable.
- The output is bound to the approval it came from: the approved content hash, the change set, and the verified-fact snapshot all travel with the build record.

## Why not `DocumentBuildManifest`

The `DocumentBuildManifest` contract records **editing an existing DOCX template in place**: it binds a source document, a template inspection profile, block-level change operations, and tracked-changes presentation. None of those exist for a document written from scratch, and a manifest may not be filled with values that were never observed. `ResumeDocumentBuild` is the narrower, honest record for this path; the template path arrives with the template work.

## Verification

`verifyDocumentBuild` re-reads the bytes that were written rather than trusting the builder's report of what it wrote. A build that fails is stored with its failures and is never served for download.

| Failure | Meaning |
|---|---|
| `output_hash_mismatch` | The stored bytes are not the bytes that were built. |
| `approval_content_mismatch` | The document was built from different approved content than the approval it cites. |
| `change_set_mismatch` | The document cites a change set other than the one it was built from. |
| `block_not_fact_backed` | A block cites a fact that is not a verified fact of this profile. |
| `block_text_not_in_document` | The build record claims a line the document does not contain. |
| `document_text_mismatch` | The document's text is not the text recorded at build time. |
| `unapproved_text_in_document` | The document contains a line no recorded block accounts for. |

## The package writer

The ZIP writer stores entries uncompressed. That keeps it small enough to audit line by line and keeps output deterministic — a compressor's version or heuristics would otherwise leak into a hash that later gates approval. The reader accepts only stored entries, so an archive from elsewhere is rejected rather than silently half-read.

Output is verified against an independent OOXML parser in the test suite, not only against this package's own reader.
