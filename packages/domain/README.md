# Domain State Machines

`@resume-agent/domain` contains pure, deterministic state machines for application runs and resume finalization.

## Guarantees

- Events use optimistic revisions and stable IDs.
- Duplicate event IDs are idempotent and re-emit the same deterministic effects.
- Unlisted transitions are rejected by default.
- Browser writes are blocked outside `running`.
- Final submission requires a matching, unexpired approval bound to the current run, action, and review snapshot.
- Approved actions are bound to an exact action ID, tool, and canonical action fingerprint before approval is requested.
- Approval consumption, state, audit, and outbox effects must be committed in one transaction.
- A crash during submission is never replayed automatically.
- Finalized resumes are immutable and must match the artifact that passed structural, privacy, render, and visual QA.

## Application lifecycle

```text
draft -> ready -> running
running <-> paused
running <-> needs_input
running <-> needs_approval
running <-> user_takeover
running <-> failed_recoverable
running -> review -> awaiting_submit_approval -> submitting
submitting -> completed | failed_final
```

`completed`, `failed_final`, and `cancelled` are terminal.

## Recovery

Recovery starts from a committed checkpoint, re-observes the current page, and compares origin and page fingerprint. Reversible writes are retried only after their postconditions are checked. Consequential actions always require manual reconciliation when their outcome is uncertain.

A checkpoint is recoverable only when its application ID, run ID, monotonic sequence, state revision, and browser-session reference match the current durable scope. Wait states never resume browser writes automatically. Takeover and consequential actions are never replayed.

## Persistence contract

The reducers are pure; the repository adapter owns the transaction boundary. Persist the returned state and its deterministic effects atomically. Approval consumption uses compare-and-set from `approved` to `consumed` in that same transaction before a browser dispatch effect becomes runnable. Effect handlers deduplicate by effect ID.

Before browser execution, a worker must durably claim the exact dispatch effect with `claimBrowserDispatch`. The claim requires the full persisted approval record in `consumed` state and binds execution to that worker plus an ephemeral claim-token hash. Execution is allowed only when the worker presents the matching raw token. A second claim is rejected.

Verified success acknowledges the delivery, while verified absence permits a reversible retry. A stale reversible claim enters recovery for postcondition inspection; a stale or uncertain consequential claim enters manual reconciliation permanently. Replaying an already-processed event never republishes a claimed or resolved browser dispatch.
