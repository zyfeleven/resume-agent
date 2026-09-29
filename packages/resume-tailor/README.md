# Resume Tailor

`@resume-agent/resume-tailor` builds a resume from verified candidate facts, tailors it to one job's requirements, and refuses to let unsupported content reach a reviewer.

## Guarantees

- Every function is pure and deterministic: no clock, no randomness, no network, no model call. The caller supplies the facts, the requirements, and the timestamp.
- **Only verified, conflict-free facts are usable.** A pending, rejected, or caller-blocked disputed fact cannot support a requirement or appear in a resume.
- Every resume line carries the fact it came from. The contract's one-fact minimum on a content item makes an uncited line unrepresentable.
- A requirement with no supporting fact is reported as `missing`. Nothing is written to claim it.
- A change set is bound to the exact verified facts and requirements it was generated from, so an edited or newly rejected fact invalidates the proposal instead of leaving an unsupported line behind.

## What Phase 1 generates

Tailoring here **selects; it does not write**. A line is `keep` when a verified fact behind it supports a requirement of this job, and `remove` otherwise — so `model` records `deterministic-selector` and `promptVersion` records `no-prompt`. Both intents cite the facts they rest on and the requirements they answer, so a reviewer reads why each line survived rather than trusting a score.

An experience entry survives even when every bullet is dropped: its role, organization, and dates are verified facts in their own right.

## Matching

`matchRequirement` is lexical and deterministic. A keyword the posting stated has to appear in the fact (`exact`), or the two have to share distinctive words (`related`). Every match records the specific fact, basis, and terms that produced it; confidence is derived from that evidence, not estimated. When the only matching verified facts are explicitly blocked as disputed, the result is `conflict` with zero confidence rather than support.

## The claim guard

`checkChangeSetClaims` is the deterministic guard for exact snapshots, verified citations, lexical support, and figures. `checkSemanticClaims` is an independent contradiction guard for polarity, outcome direction, responsibility, and proficiency. Both reports bind to the hash of the exact reviewed resume wording.

| Violation | Meaning |
|---|---|
| `fact_not_verified` | A change cites a fact that is pending or rejected. |
| `fact_not_in_snapshot` | A change cites a fact that is not in this profile. |
| `requirement_not_in_snapshot` | A change cites a requirement that is not in this job. |
| `before_text_altered` | A change misreports the wording it is replacing. |
| `unsupported_claim` | Proposed wording introduces terms absent from the cited facts. |
| `unsupported_number` | Proposed wording states a figure absent from the cited facts. |
| `fact_snapshot_mismatch` | The verified facts changed after the change set was generated. |
| `semantic_negation_conflict` | Reviewed wording reverses a positive or negative fact. |
| `semantic_direction_conflict` | Reviewed wording reverses an increase or decrease. |
| `semantic_responsibility_inflation` | Supporting work is upgraded to ownership or leadership. |
| `semantic_proficiency_inflation` | Limited familiarity is upgraded to advanced or expert proficiency. |

Generation records both reports before review. Approval recomputes both over the sentence choices the reviewer actually made, using the current fact and requirement snapshots; the DOCX build repeats that check. A missing, stale, wrong-layer, content-hash-mismatched, or failing report blocks the state transition, with no silent fallback.

## Review

`sentenceChanges` deterministically projects each change into sentence-sized choices between proposed and fallback text. `reviewSentenceChange` binds one decision to the digest of that exact sentence, including its facts and requirements, so regenerated wording cannot inherit an earlier approval. `applyReviewedChanges` composes the decided sentences, previews undecided sentences as proposed, and keeps approval blocked until every sentence is reviewed. Legacy whole-change reviews remain valid and apply the same choice to every sentence in that change.
