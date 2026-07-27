# Policy Engine

`@resume-agent/policy` is the deterministic, value-free gate in front of Browser MCP actions. It receives action metadata, origin metadata, redacted field metadata, provenance status, confidence, and safety signals. It never accepts candidate answers, secrets, DOM text, cookies, or credentials.

| Route | Meaning |
|---|---|
| `automatic` | The orchestrator may issue a reversible policy grant; Browser MCP still validates its snapshot, reservation, and postconditions. |
| `confirmation` | Pause for a user decision. Uploads and final submit require a bounded approval; submit additionally requires the existing consumed, one-use Browser MCP authorization. |
| `takeover` | Stop agent browser actions and ask the user to operate the local browser. |
| `prohibited` | Do not execute or retry the requested action. |

The matrix is fail-closed:

- only same-origin actions within the allowlist can be automatic;
- high-confidence (`>= 0.90`), sourced, verified normal/PII facts are the only fields eligible for automatic filling;
- medium/low confidence, unsourced facts, reusable answers, uploads, and review-all preference route to confirmation;
- secrets, sensitive/protected/legal questions, login, MFA, CAPTCHA, and unfamiliar widgets route to takeover;
- unknown tools, synthetic submit targets, prompt-injection instructions, security-bypass requests, and unexpected downloads are prohibited;
- `browser_submit` is always `confirmation` with `final_submission` scope. A policy decision is not itself a submission token.

The caller must record the input and decision in the audit trail, then separately satisfy the Browser MCP and application-state-machine authorization requirements.
