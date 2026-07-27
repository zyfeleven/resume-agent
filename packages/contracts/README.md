# Shared Contracts

`@resume-agent/contracts` is the versioned data boundary shared by the dashboard, orchestrator, policy engine, and MCP services.

## What belongs here

- Candidate profiles, verified facts, and reusable answer policies
- Jobs, JD requirements, and requirement-to-fact matches
- Resume IR, change sets, and resume versions
- Applications, observed form fields, decisions, actions, and approvals
- Browser MCP tool inputs, structured outputs, snapshots, locator recipes, and write verification
- Document MCP inputs, immutable lineage manifests, render evidence, privacy reports, QA, and exact-byte export
- Artifacts and audit events

The Zod schemas are the runtime source of truth. Generated JSON Schemas in `schemas/` support service boundaries, MCP tools, and non-TypeScript workers.

## Commands

From the repository root:

```text
npm run typecheck
npm test
npm run contracts:schemas
```

Generated files must be committed whenever a public schema changes.

## Browser MCP boundary

The Browser MCP catalog exposes only session open, snapshot, allowlisted navigation, field setting, non-submit activation, takeover, approved artifact upload, and approval-bound submission. It deliberately exposes no arbitrary JavaScript, generic click, raw selector, element handle, or local filesystem path.

All writes bind to an application run and immutable canonical action fingerprint. Except for the initial session open, writes also bind to a short-lived snapshot lease, page generation and fingerprint, predecessor checkpoint, a just-in-time live-page observation, and a trusted persisted authorization record. Locator recipes are produced by the server and referenced by ID. IDs are unique inside a snapshot and every frame belongs to one rooted frame tree. A successful write must include a fresh before/after snapshot, exact locator and frame-path evidence, postconditions derived from the after snapshot or trusted evidence artifacts, a newer durable checkpoint containing the action, an authorization receipt, and redacted evidence artifacts. Upload and final submit are always consequential.

JSON Schema validation alone is not sufficient for relationships across records. Session-open and snapshot reads must be registered through `createValidatedBrowserMcpReadHandler()`; browser writes must use `createValidatedBrowserMcpWriteHandler()`. These boundaries enforce semantic validation before execution and again before returning a result. The trusted-context loader is server-owned and must atomically reserve every write action, including policy-authorized reversible actions, as a one-time, short-lived `executing` reservation. It must refuse a second transition. The write handler never gives trusted context to the browser executor, reloads detached snapshots, artifacts, and evidence from trusted storage after execution, and awaits an atomic settlement on every exit path. The validators runtime-parse the complete trusted context, recompute canonical raw-value and action hashes, and verify deadlines, authorization, origins and closed redirect chains, live page state, frame ancestry, snapshot and locator ownership, target kind, intent-specific activation changes, derived postconditions, trusted artifacts and exact-attempt evidence, and checkpoint scope. `buildBrowserMcpWireTools()` produces protocol-ready MCP tool definitions with actual `inputSchema` and `outputSchema`; `parseBrowserMcpStructuredContent()` performs shape validation for non-executing consumers and is not an execution boundary.

Attempted writes are never labeled retryable. An attempted action may be marked `verified_not_applied` only when trusted transport evidence proves that no request was sent or trusted server evidence proves rejection before commit. Otherwise the result is `uncertain` or `manual_reconciliation`, which prevents automatic replay.

## Document MCP boundary

The Document MCP catalog exposes nine narrow tools: safe DOCX parsing, template inspection, approved change-set application, text diff, deterministic page rendering, visual diff, structure and accessibility audit, privacy scrub, and exact-byte artifact export. It exposes no local paths, storage keys, raw bytes, arbitrary OOXML, XPath, macros, scripting, or network access. Every input artifact is an immutable ID/hash reference and every derivative receives a new artifact ID with explicit lineage.

Document reads use `createValidatedDocumentMcpReadHandler()` so package, snapshot, manifest, render, diff, and QA records are loaded from trusted storage both before and after worker execution. Document writes use `createValidatedDocumentMcpWriteHandler()`, which atomically reserves a one-time authorization, recomputes the canonical action fingerprint, withholds trusted context from the worker, reloads output bytes and evidence, validates exact cross-record lineage, and settles the trusted reservation in `finally` on every exit path.

The contract rejects macros, ActiveX, OLE, embedded packages, `altChunk`, external relationships, unsafe field codes, unsafe ZIP entries, and unbounded packages. A resume build must bind the exact approved change set, verified fact and JD requirement snapshots, aggregate content approval, active template, source revision, and output content hash. Privacy scrub must produce a new artifact, preserve the visible semantic text hash, re-run package security, and leave zero forbidden residue. Rendering uses pinned worker/runtime/font hashes and emits a continuous set of immutable page PNGs. QA has twelve fixed, non-skippable checks and requires a 100% inspection record for every rendered page. Export only promotes the exact QA-approved bytes; it never edits, converts, accepts tracked changes, or silently removes comments during export.

Every DOCX build additionally carries one immutable, approved `DocumentPresentationPlan`. It is the global order of all dynamic visible blocks: an item either maps to a final ResumeIR content item or to explicitly named verified facts (for headers and experience headings). A plan is canonical JSON: normalize strings to NFC; recursively sort object keys; omit `undefined` object properties; preserve array order; UTF-8 encode; hash with SHA-256 as lowercase hexadecimal. `computeDocumentCanonicalHash()` is the reference implementation. The plan artifact's content hash, approval hash, build-manifest hash, output block bindings, template slots, styles, and output order must agree. Static template blocks are an explicit exact-text allowlist; no other unbound text may survive into the final DOCX.

## Invariants outside schema validation

Cross-record rules belong in domain or policy packages. Examples include verifying that referenced facts exist, preventing unsupported resume claims, checking approval expiry against the current time, and enforcing legal state transitions.
