# Resume Tailor

`@resume-agent/resume-tailor` builds a resume from verified candidate facts, tailors it to one job's requirements, and refuses to let unsupported content reach a reviewer.

## Guarantees

- Every function is pure and deterministic: no clock, no randomness, no network, no model call. The caller supplies the facts, the requirements, and the timestamp.
- **Only `verified` facts are readable.** A pending or rejected fact is invisible to every step here, so nothing a person has not confirmed can appear in a resume or match a requirement.
- Every resume line carries the fact it came from. The contract's one-fact minimum on a content item makes an uncited line unrepresentable.
- A requirement with no supporting fact is reported as `missing`. Nothing is written to claim it.
- A change set is bound to the exact verified facts and requirements it was generated from, so an edited or newly rejected fact invalidates the proposal instead of leaving an unsupported line behind.

## What Phase 1 generates

Tailoring here **selects; it does not write**. A line is `keep` when a verified fact behind it supports a requirement of this job, and `remove` otherwise — so `model` records `deterministic-selector` and `promptVersion` records `no-prompt`. Both intents cite the facts they rest on and the requirements they answer, so a reviewer reads why each line survived rather than trusting a score.

An experience entry survives even when every bullet is dropped: its role, organization, and dates are verified facts in their own right.

## Matching

`matchRequirement` is lexical and deterministic. A keyword the posting stated has to appear in the fact (`exact`), or the two have to share at least two distinctive words (`related`). Anything else is `missing`. Confidence is derived from that overlap, not estimated.

## The claim guard

`checkChangeSetClaims` decides whether a change set may be shown to a reviewer at all. It runs identically over a change set built by selection and one written by a model, which is why generated prose can be introduced later without widening the trust boundary — proposed text has to be traceable to the facts it cites, or the change set never reaches the review screen.

| Violation | Meaning |
|---|---|
| `fact_not_verified` | A change cites a fact that is pending or rejected. |
| `fact_not_in_snapshot` | A change cites a fact that is not in this profile. |
| `requirement_not_in_snapshot` | A change cites a requirement that is not in this job. |
| `before_text_altered` | A change misreports the wording it is replacing. |
| `unsupported_claim` | Proposed wording introduces terms absent from the cited facts. |
| `unsupported_number` | Proposed wording states a figure absent from the cited facts. |
| `fact_snapshot_mismatch` | The verified facts changed after the change set was generated. |

The lexical check is the deterministic half of the guard. The semantic half — catching wording that reuses the right words to say something the facts do not support — is a later phase, and the resume state machine requires both before a version can be fact-checked.

## Review

`reviewChange` records one decision, bound to the digest of the exact change the reviewer saw, so a regenerated change set cannot inherit an approval meant for different wording. `applyReviewedChanges` then builds the resume the reviewer is looking at: an approved change applies as proposed, a rejected one applies in reverse — rejecting a removal is how a reviewer keeps a line — and undecided changes are shown as proposed and counted as pending, because a resume may not be finalized while any change is unreviewed.
