# Shared Contracts

`@resume-agent/contracts` is the versioned data boundary shared by the dashboard, orchestrator, policy engine, and MCP services.

## What belongs here

- Candidate profiles, verified facts, and reusable answer policies
- Jobs, JD requirements, and requirement-to-fact matches
- Resume IR, change sets, and resume versions
- Applications, observed form fields, decisions, actions, and approvals
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

## Invariants outside schema validation

Cross-record rules belong in domain or policy packages. Examples include verifying that referenced facts exist, preventing unsupported resume claims, checking approval expiry against the current time, and enforcing legal state transitions.
