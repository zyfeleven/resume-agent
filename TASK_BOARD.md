# Resume Agent Task Board

Last updated: 2026-09-24

Earlier milestones were verified locally with `npm run typecheck`, `npm test`, and `npm run build`. JA-01 was checked with the dashboard test suite (68 passed, one opt-in live test skipped), dashboard typecheck/build, and isolated browser acceptance against public boards. Real Gemini-key generation is not yet acceptance-tested.

JA-02 source-discovery increment: dashboard suite now has 88 passing tests and one opt-in live test skipped; typecheck and production build pass. Browser acceptance covers actual no-key behavior and explicitly mocked discovery/enrollment responses at desktop and 390px mobile width. No real Brave/Gemini requests or applications were sent.

JA-02 posting-filter increment: 35 additional tests; latest dashboard total is 123 passing and one opt-in live test skipped. Typecheck/build pass. Isolated browser acceptance with three labeled fixture postings and the real local API confirmed re-filtering (3 → 2 → 1), saved settings after reload, source-line evidence and a 390px layout without horizontal overflow. No search/model calls or applications were made.

This file is the public source of truth for project progress. Update it in the same commit as the work whose status changes.

JA-03a application-preparation checklist: 38 additional tests; dashboard total is 161 passing and one opt-in live test skipped. Typecheck and production build pass. Isolated production-browser acceptance found and fixed encoded task-ID routing, verified the card-to-checklist link and cancellation on refresh, and checked desktop/390px layouts. Checks are a read-only local projection, not live availability or a submission authorization. No runner/P6 rendering implementation changes or real API-key requests are included.

JA-03b Greenhouse public-form preflight: 34 additional offline tests plus one opt-in live smoke; default dashboard suite has 195 passing and two live tests skipped. The ATS suite passes all 35 with its live flag enabled. Typecheck/build pass. Isolated browser acceptance read a real public posting (11 questions, 5 required groups), verified instructions/options and mobile layout, and confirmed revoked approval returns 409 and clears the preview. No candidate facts, form answers, uploads or submissions were sent. Browser DOM capture and Gemini answer preparation for these real forms are still pending.

JA-03c Gemini narrative answer preparation: 34 new offline tests; dashboard total 229 passing and two opt-in live tests skipped. Typecheck/build pass. Native Gemini integration, local persistence, cited-fact wording review and stale-plan refusal are implemented. Browser acceptance verifies real no-key behavior and explicitly simulated draft/review responses; real Gemini-key acceptance remains pending. No ATS fields, uploads or submissions are enabled. This supersedes JA-03b's pending answer-preparation item, not its pending browser DOM adapter.

JA-03d hosted-page observation: 30 new browser-module tests and 26 new dashboard offline tests, plus one opt-in live DOM smoke. Dashboard total 255 passing/3 live tests skipped; browser module 63 passing. Typechecks/build pass. The live public-form → browser → reconciliation smoke passes with isolated approval records and no candidate data/model key. A real public posting exposed 26 controls; custom controls and network restrictions remain manual/partial. No field writes, uploads or submission. P6 and the existing fixture runner implementation are unchanged.

JA-03e1 reviewed-answer plan preview: 40 new offline tests; dashboard total 295 passing and three opt-in live tests skipped. Typecheck/build pass. Durable five-minute previews bind approved answer wording/review history and facts to fresh DOM correspondence; preview approval reobserves the page and never grants browser-write authority. This is the narrative-plan portion of JA-03e, not real-site execution or document upload. Desktop-only verification per user preference; no mobile work or P6 changes.

## Status legend

STORE-01 Windows JSON replacement recovery: the pre-fix focused run reproduced two rename EPERM failures (70 passed/2 failed). JSON updates now use exclusive UUID staging and bounded Windows EPERM/EBUSY rename retries without repeating callbacks or browser actions. Persistent errors preserve old records and propagate; no ACL changes or delete/copy fallback. The single-process queue remains held through replacement. Added 27 tests for retry/exhaustion, staging cleanup, queue ordering, 200 real-filesystem updates and ATS persistence boundaries. Default parallel and serial dashboard regressions each passed 419 tests/3 opt-in live skipped; typecheck and production build passed. P6 implementation and real application submission are unchanged; this is not proof of the underlying OS lock owner or a multi-process storage solution.

JA-03e2b2d presentation initialization diagnostics: a public-only comparison identified blocked English translation dictionaries as a missing initialization dependency. The observer now narrowly accepts the two versioned `job_post`/`common` JSON namespaces, validates status/type/size, marks pending/failed loads unsafe for automation, discards in-flight responses after network lock, and detects reCAPTCHA/hCaptcha script dependencies before any visible challenge. A real Spaceium observation reports access-check and DOM-change signals; no click, candidate data, attachment or submission followed. This does not establish real-widget activation or upload compatibility. P6 is unchanged.

JA-03e2b2d verification: 34 new regression tests (33 browser, one dashboard). Browser suite: 189 passed. Dashboard serial run: 390 passed, 2 failed, 3 opt-in live skipped; both failures were existing Windows temporary-store atomic rename EPERM errors, now also reproduced in serial mode. The full dashboard run is not green; no permission or storage implementation change was attempted. Browser and dashboard typechecks and the production dashboard build pass. The offline Chromium integration test uses only synthetic response bytes and verifies initialization followed by access-check detection. Temporary diagnostic browsers were closed; real-key acceptance remains pending.

JA-03e2b2c offline widget-switch diagnostic: separate explicit consent permits one Enter manually click in an ephemeral, network-frozen browser for the known Resume/CV file/text group. The server verifies posting/schema approval before and after, rejects wrong/ambiguous/occupied controls, closes on every outcome, returns no candidate values and never retries. Successful results are diagnostic-only and explicitly blocked from fill-plan approval. The real Spaceium page did not mount `resume_text` under the restricted/offline conditions; it remains unsupported for attachment.

JA-03e2b2c verification: 27 new tests (15 browser, 12 dashboard); browser suite 156 passed, dashboard suite 391 passed/3 opt-in live skipped in serial mode. Two parallel dashboard attempts encountered Windows temporary-store rename EPERM errors; that intermittency remains open. Typechecks and production build pass. Desktop production acceptance with explicitly simulated responses verified unchecked consent/disabled action, diagnostic-only success, consent reset and removal of stale results on failure. Screenshots were visually checked; console output was limited to the existing favicon 404 and expected simulated 409, with no server errors. The isolated browser and server were closed. No real model key, candidate upload, employer submission or P6 implementation change was made.

JA-03e2b2b labelled native picker: a separately confirmed offline attachment can now target a hidden `resume` file input only when one visible native Attach label uniquely owns it within an explicitly named Resume/CV group, with a mounted empty `resume_text` alternative. The picker association is persisted and hash-bound; wrong/shared/missing associations remain manual. No button clicks, style changes, file-dialog automation, networking or P6 changes. The real page previously observed still has an unmounted alternative and remains unsupported.

JA-03e2b2b verification: 27 additional tests (17 browser, 10 dashboard); full totals browser 141 passed, dashboard 379 passed/3 opt-in live skipped. Typechecks and production build pass. Desktop production acceptance with explicitly simulated responses verified the hidden-input association preview, separate unchecked consent, disabled repeat execution after a local receipt and stop/close. Screenshots were visually checked; only the existing favicon 404 appeared, and server errors were empty. Temporary browser/server resources were closed. A real public-only observation still refused the live widget (unmounted alternative and nonvisible label); no employer write or real key was used.

JA-03e2b2a upload-widget preflight: corrected the false-visible classification of clipped/transparent native file controls, including ancestor styles and disabled fieldsets. Snapshots now carry value-free explicit upload-group ownership, file filters and dormant alternative references. Correspondence explains hidden controls, unresolved alternatives, unsupported file modes and ambiguous ownership without treating a group label as attachment authorization. The real Spaceium page now correctly reports hidden Resume/CV and Cover Letter inputs with unmounted text alternatives. Network delivery, custom-widget activation and submission remain open; P6 is unchanged.

JA-03e2b2a verification: 30 added tests (20 browser, 10 dashboard); full browser suite 124 passed, dashboard 369 passed/3 opt-in live skipped. Typechecks and production build pass. Read-only real-site observation confirmed the corrected classification; desktop production acceptance with explicitly simulated responses confirmed separate upload-group diagnostics and clearing stale evidence after a failed refresh. Screenshot inspection passed, server error log was empty, and temporary browser/server resources were closed. No model key, candidate data, employer writes or mobile work.

JA-03e2b1g grouped resume compatibility: adds the documented native `resume`/`resume_text` file-or-text group. Both identities are bound to attachment consent; existing pasted text is never cleared, and pre/post file checks refuse nonempty or changed alternatives. A live public-only observation found an Attach-labelled control with no observed alternative, correctly remaining unsupported; no candidate data was supplied. Network delivery and custom-widget handling remain open.

Verification for JA-03e2b1g: 13 additional dashboard tests and 10 actual-Chromium offline tests; dashboard 359 passed/3 opt-in live skipped, browser 104 passed. Typechecks and production build pass. Desktop acceptance with explicitly simulated responses confirmed the paired-control preview, separate unchecked consent, consumed/stopped state after a simulated text conflict, disabled repeat attachment and available stop/close. Screenshots were inspected; no page/section horizontal overflow was measured. No real model call, employer transmission, mobile work or P6 changes.

JA-03e2b1 verified offline attachment: 30 additional dashboard tests and 11 browser tests. Dashboard 346 passed/3 live skipped; browser 94 passed; typechecks/build pass. Existing document gates are reused unchanged, exact bytes are handed to one supported file input under separate one-use consent, and local read-back is hashed. Single visible native resume input only; no employer upload/delivery, network reconnect, final submission, real-key acceptance, mobile work or P6 changes.

JA-03e2a supervised offline narrative filling: 21 new dashboard tests and 20 additional browser tests; dashboard total 316 passed/3 live skipped, browser module 83 passed. Typechecks and production build pass. Separate open/one-use consent/stop controls connect approved previews to a held desktop Chromium session, network freeze, field policy/reservations and hashed read-back. Real browser tests use offline HTML; no real Gemini or employer write acceptance, uploads, delivery or final submission. P6 is unchanged. Desktop acceptance uses explicitly labeled response fixtures plus a real missing-preview refusal.

- `DONE` — completed and verified
- `IN PROGRESS` — actively being implemented; keep this list small
- `NEXT` — ready to start with no known blocker
- `BACKLOG` — planned but not yet ready
- `BLOCKED` — waiting on a concrete dependency or decision

## Done

| ID | Task | Result |
|---|---|---|
| STORE-01 | Bounded Windows JSON replacement recovery | Exclusive staging, rename-only retries under the existing queue, persistent-error propagation and old-record preservation; business/browser callbacks are never replayed |
| JA-03e2b2d | Bounded presentation dictionaries and initialization safety | Two validated English CDN dictionaries; pending/failed assets block automation, late responses are dropped after network freeze, and CAPTCHA script dependencies require manual inspection. Live upload remains unsupported |
| JA-03e2b2c | Separately confirmed offline resume-text switch inspection | One validated native button click after network freeze, empty native textarea verification, fixed-stage errors, mandatory close and diagnostic-only results; no upload or held-session activation |
| JA-03e2b2b | Separately authorized labelled native picker | Exact visible-label/hidden-input/group association bound to one-use artifact consent; native byte selection and read-back stay offline, with existing text protected |
| JA-03e2b2a | Read-only custom upload-widget evidence and diagnostics | Distinguishes named file groups, clipped controls and unmounted text alternatives; metadata participates in structural freshness checks. Does not activate pickers or permit hidden-file writes |
| JA-03e2b1g | Native resume file/text alternative groups | Explicit file-branch scope, unique observed targets, unchanged empty-text checks before/after selection, no text disclosure or clearing; hidden file/custom/incomplete groups remain manual. Offline only |
| JA-03e2b1 | Verified DOCX → separately authorized offline attachment | Task-specific current document gates, metadata preview/download-for-review, artifact-bound one-use consent, native file selection and exact-byte read-back; replay/stale/occupied/unsupported controls refused. Does not deliver a file to the employer |
| JA-03e2a | Separately authorized supervised offline narrative writes | Open-without-typing, explicit one-use consent persisted before writes, current evidence checks, offline browser, field reservations/read-back, partial-failure receipts and stop/close. Local/offline tests only; no employer delivery or submit authority |
| JA-03e1 | Reviewed narrative answer → DOM plan preview | Exact approved wording/control correspondence, persistent preview review/rejection/deletion, five-minute expiry and answer/fact/approval/DOM invalidation. No fill/upload/submit authority |
| JA-03d | Applicant-facing Greenhouse read-only browser observation | Isolated bounded Chromium, restricted request policy, value-free control snapshot, schema/approval freshness and conservative question reconciliation; offline and live public-site checks pass. No fill/upload/submit authority |
| JA-03c | Gemini narrative drafts and durable wording review | Filtered verified facts, exact question coverage and grounded-wording checks; persisted per-task drafts/citations/review history, schema/fact/approval freshness checks and deletion. Offline/local UI verification only; real-key acceptance pending, no ATS write authority |
| JA-03b | Greenhouse public application-form preflight | On-demand bounded public GET; exact posting/approval checks before and after reading, grouped required/alternative inputs, instructions/options and manual consent notices. Real API and browser acceptance pass; no fill plan or submission authority |
| JA-03a | Task-specific application preparation checklist | Exact posting/JD/resume linkage, current sentence and claim checks, content approval and verified DOCX status; links back to the exact Resume Studio change set. No real-site form, upload or submit authority |
| JA-01 | Public job discovery and approval-to-resume orchestration | Greenhouse/Lever collection, GTA/Ottawa/Kingston preferences, persisted inbox/decisions/tasks, Gemini evidence assessment and preparation, exact Resume Studio handoff. Local workflow/provider tests pass; browser verifies real collection, save, approval, no-key blocking and persistence. No real-site submission; live Gemini-key acceptance remains outstanding |
| SETUP-01 | Create the public GitHub repository | Repository initialized with `main` as the default branch |
| ARCH-01 | Define the product boundary | Human-supervised resume tailoring and form filling; no unattended submission |
| ARCH-02 | Define the high-level architecture | Dashboard, orchestrator, policy engine, Browser MCP, and Document MCP boundaries agreed |
| DOCS-01 | Publish the public English project overview | README documents the vision, architecture, safety model, and roadmap |
| PRIV-01 | Keep private architecture planning local | Private Chinese planning documents are excluded from Git |
| P0-01 | Define shared domain contracts | Versioned Zod contracts, generated JSON Schemas, and representative validation tests are available to all workspaces |
| P0-02 | Define application and resume state machines | Durable state transitions, scoped checkpoints, one-shot approval dispatch, safe recovery, and 19 domain tests |
| P0-03 | Define Browser MCP contracts | Eight snapshot-first tools, fail-closed read/write handlers, one-time write reservations, trusted evidence reload, and 14 browser contract tests |
| P0-04 | Define Document MCP contracts | Nine closed-world DOCX tools, immutable presentation plans, trusted lineage validation, and 39 contract tests |
| P0-05 | Implement the policy matrix | Deterministic, value-free policy package routes form actions through automatic, confirmation, takeover, or prohibited outcomes; final submission always requires a scoped approval |
| P0-06 | Build the threat model | Public threat model maps untrusted-input, approval, artifact, secret, retention, and MCP risks to current controls, release blockers, and executable checks |
| P0-07 | Build the fixture-form specification | Public fixture spec assigns deterministic IDs and safe, no-network behavior to every MVP control, safety boundary, and fake-submission scenario |
| P1-01 | Create the minimal Next.js dashboard shell | Overview and application workspace provide a responsive local control plane with runner, safety, review, and approval visibility; metadata and a social preview are included, and the production build is verified |
| P1-02 | Import one master resume and review extracted facts | A local `.docx`, `.txt`, or `.md` resume yields line-cited pending facts in the profile vault; the user verifies or rejects each one against the exact value shown, credential-like lines are dropped before storage, re-import preserves prior decisions, and local data is deletable |
| P1-03 | Parse one pasted JD into structured requirements | A pasted posting yields line-cited requirements routed to must-have, preferred, or context by the section they were written under; keywords are verbatim, agent-directed and credential-like lines are dropped before storage, benefits and legal sections are excluded, the reviewer can correct priority and kind or dismiss a line, and re-parsing keeps those corrections |
| P1-04 | Generate one fact-backed resume change set | Resume Studio builds a resume from verified facts only and tailors it to one job by selection; every change cites the facts it rests on and the requirements it answers, unmatched requirements are reported rather than claimed, and a deterministic claim guard blocks any change set citing an unverified fact, a foreign requirement, altered original wording, or — for generated prose — terms or figures absent from its cited facts |
| P1-05 | Produce and preview one DOCX version | Approving a fully reviewed change set freezes its content; the DOCX is built from that approval alone, read back off disk and checked against it, previewed in Resume Studio, and downloadable only after it verifies. The resume state machine gates fact-check, approval, and `docx_built`, and regenerating clears the approval and document that rested on the old wording |
| P1-06 | Launch a local Playwright runner from the dashboard | The dashboard starts, observes, and stops a real local Chromium session against the fixture lab. Every tool call is evaluated by the policy engine before the browser is touched and recorded with its route and reasons; a page-declared login, MFA, or CAPTCHA condition refuses every following call; snapshots carry structure and never a field value; the runner shipped with read tools only, so at that point nothing could be typed or submitted |
| P1-07 | Fill basic fixture-form controls and stop at final review | The runner fills a field only when a verified fact answers it by name and the policy engine allows it; sensitive, tagged, and unanswered fields stay with the person; each write is planned against a snapshot taken then, takes a single-use reservation, and is verified by a digest the page computes; a write aimed at the submit control is refused, and no submit tool exists |
| P2-01 | Add candidate fact evidence and conflict review | The profile vault groups competing values with every source file, locator, excerpt, and import time; a hash-bound decision verifies one candidate and rejects its alternatives, while every unresolved candidate—including previously verified facts—is excluded from resume generation, document building, approvals, and browser filling |
| P2-02 | Add the JD-to-fact match matrix | Resume Studio shows every requirement beside its JD citation and the exact candidate facts, resume citations, matching terms, rationale, and deterministic confidence; missing requirements remain explicit, disputed facts are removed when trustworthy support exists, and a disputed-only match is zero-confidence conflict rather than support |
| P2-03 | Add sentence-level resume change review | Every keep, remove, rewrite, or combine change is deterministically projected into sentence-sized choices; each decision is hash-bound to the exact proposed/fallback text, facts, and requirements, stale decisions fail closed, approval waits for every sentence, and legacy whole-change reviews remain readable |
| P2-04 | Implement deterministic and semantic claim guards | Independent deterministic and semantic reports validate current fact and requirement snapshots plus exact finalized wording; semantic violations explain polarity, direction, responsibility, and proficiency contradictions, and generation, approval, document build, and the resume state machine all fail closed unless both content-hash-bound layers pass |
| P2-05 | Support one high-fidelity DOCX template | Approved content is applied to a versioned, ATS-safe single-column OOXML template with explicit Arial typography, named paragraph styles, real Word bullet numbering, section hierarchy, spacing, and Letter page geometry; approval and verification bind the template ID, version, and fingerprint while every emitted paragraph remains fact-backed |
| P2-06 | Add structural, privacy, render, and visual quality gates | Every build is audited for canonical ZIP integrity, package safety, privacy residue, ATS-safe OOXML structure, exact-byte render evidence, and full-page visual defects; all five hash-bound gates are revalidated at download, while missing, stale, malformed, or replayed evidence fails closed |
| P2-07 | Add resume version restore and reproducible artifact manifests | Approved snapshots remain immutable and can be reactivated through a hash-bound restore record that preserves the original version, approval, change set, parent, and template lineage; every downloadable DOCX has a deterministic JSON manifest binding exact output/text hashes to content, fact and requirement snapshots, approval, template/builder versions, render evidence, and all five QA gates, and both downloads revalidate it |
| P3-01 | Implement generic field extraction and normalization | The runner understands a form with no test IDs, no sensitivity markers, and no submit marker: fields are classified from autocomplete tokens, visible labels, input types, and control names, with the evidence and a confidence the policy engine acts on; sensitivity is read from what a question asks, so EEO, work-authorization, and compensation fields stay with the person on a page that marks nothing; writes resolve through label, name, and placeholder locators, and a plain submit button is still recognised as one |

## In progress

| ID | Task | Deliverable | Exit criteria |
|---|---|---|---|

## Next

| ID | Task | Deliverable | Exit criteria |
|---|---|---|---|
| JA-02 | Expand job discovery beyond configured company boards | Brave source discovery/enrollment plus optional experience, annual CAD salary and work-mode filters with explicit unknown handling; provider, filter and browser checks pass | Real-key acceptance, broader eligibility/ATS coverage and optional scheduling remain |
| JA-03e2b2 | Extend the supervised pilot beyond offline attachment | Explicit network/delivery authorization and narrow ATS upload handling, including supported grouped/native/custom control behavior | Offline file selection is not employer upload. Current bytes, destination and consent must bind delivery; real-site acceptance and final submission remain separate |
| P3-04 | Add confidence routing and reusable answer policies | Optional Gemini-assisted field mapping and fact-grounded application answers, with local Playwright execution | Code, mocked-provider tests, privacy filtering, claim guards, stale-plan refusal, and production build pass; live API-key validation and durable reviewer-approved reuse remain |
| AI-01 | Add optional Gemini semantic resume tailoring | JD-to-fact semantic matching and fact-grounded rewrites that feed the existing sentence review and claim guards | Code, mocked-provider privacy and hallucination tests, contracts, and production build pass; live API-key validation remains |
| P3-02 | Support custom selects, repeated sections, frames, and multi-step forms | The controls a real posting is actually built from | The runner handles an accessible combobox, a repeated section, a same-origin iframe, and a multi-step flow, re-observing after every mutation |

## Backlog

Phase 2 is complete. Phase 3 continues the adaptive browser work stream.

### Phase 3 — Adaptive browser engine

- `P3-03` Add approved artifact uploads and post-fill validation.
- `P3-05` Add snapshots, screenshots, traces, and durable checkpoints.
- `P3-06` Add safe human takeover for login, MFA, CAPTCHA, and unfamiliar widgets.
- `P3-07` Recover safely after dynamic DOM changes and runner restarts.

### Phase 1 — End-to-end local vertical slice

- `P1-08` Persist a complete redacted audit timeline.

### Phase 4 — Product hardening and ATS compatibility

- `P4-01` Complete the three-pane Application Workspace.
- `P4-02` Add the approval and notification inbox.
- `P4-03` Add MCP health, retention, and autonomy settings.
- `P4-04` Benchmark Greenhouse, Lever, and Workday flows.
- `P4-05` Add narrow ATS adapters only where the generic engine is insufficient.
- `P4-06` Publish compatibility grades and known limitations.

### Phase 5 — Production readiness

- `P5-01` Add authentication, encryption, deletion, and retention controls.
- `P5-02` Add queue isolation, concurrency limits, rate limits, and a global kill switch.
- `P5-03` Add metrics, alerts, cost tracking, and evaluation suites.
- `P5-04` Package the local runner and hosted dashboard deployment.
- `P5-05` Complete terms-of-service and compliance review before broad production use.

## Project-wide acceptance targets

- Zero unapproved final submissions.
- Zero unsupported claims in finalized resumes.
- Zero secrets committed to Git or written to ordinary logs.
- At least 95% correct mapping on the maintained common-field fixture suite.
- 100% of sensitive and low-confidence fields routed to user review.
- Browser tasks recover from the latest durable checkpoint.
- Every finalized DOCX passes structural checks and full-page visual review.

## Board maintenance rules

1. Each implementation task receives a stable ID.
2. Keep no more than three tasks in `IN PROGRESS` unless parallel ownership is explicit.
3. Move tasks only when their exit criteria are met.
4. Record blockers as concrete dependencies, not general uncertainty.
5. Update the board in the same commit as completed work.
6. Split tasks that cannot be completed and reviewed in a small pull request.
