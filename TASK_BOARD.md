# Resume Agent Task Board

Last updated: 2026-07-27

This file is the public source of truth for project progress. Update it in the same commit as the work whose status changes.

## Status legend

- `DONE` — completed and verified
- `IN PROGRESS` — actively being implemented; keep this list small
- `NEXT` — ready to start with no known blocker
- `BACKLOG` — planned but not yet ready
- `BLOCKED` — waiting on a concrete dependency or decision

## Done

| ID | Task | Result |
|---|---|---|
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

## In progress

| ID | Task | Deliverable | Exit criteria |
|---|---|---|---|
| P0-07 | Build the fixture-form specification | Coverage matrix for native controls, custom widgets, dynamic DOM, validation, uploads, and fake submission | Every MVP control has at least one deterministic fixture |

## Next

| ID | Task | Deliverable | Exit criteria |
|---|---|---|---|

## Backlog

### Phase 1 — End-to-end local vertical slice

- `P1-01` Create the minimal Next.js dashboard shell.
- `P1-02` Import one master resume and review extracted facts.
- `P1-03` Parse one pasted JD into structured requirements.
- `P1-04` Generate one fact-backed resume change set.
- `P1-05` Produce and preview one DOCX version.
- `P1-06` Launch a local Playwright runner from the dashboard.
- `P1-07` Fill basic fixture-form controls and stop at final review.
- `P1-08` Persist a complete redacted audit timeline.

### Phase 2 — Resume Studio and document reliability

- `P2-01` Add candidate fact evidence and conflict review.
- `P2-02` Add the JD-to-fact match matrix.
- `P2-03` Add sentence-level resume change review.
- `P2-04` Implement deterministic and semantic claim guards.
- `P2-05` Support one high-fidelity DOCX template.
- `P2-06` Add structural, privacy, render, and visual quality gates.
- `P2-07` Add resume version restore and reproducible artifact manifests.

### Phase 3 — Adaptive browser engine

- `P3-01` Implement generic field extraction and normalization.
- `P3-02` Support custom selects, repeated sections, frames, and multi-step forms.
- `P3-03` Add approved artifact uploads and post-fill validation.
- `P3-04` Add confidence routing and reusable answer policies.
- `P3-05` Add snapshots, screenshots, traces, and durable checkpoints.
- `P3-06` Add safe human takeover for login, MFA, CAPTCHA, and unfamiliar widgets.
- `P3-07` Recover safely after dynamic DOM changes and runner restarts.

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
