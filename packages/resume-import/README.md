# Resume Import

`@resume-agent/resume-import` turns an already-extracted resume text into pending candidate facts, and applies the user's review decisions to them.

## Guarantees

- The extractor is pure and deterministic: no clock, no randomness, no network, no model call, and no file or URL access. The caller supplies the text, the artifact identity, and the import timestamp.
- Every emitted value is a normalized slice of a source line. Nothing is paraphrased, completed, or inferred.
- Every fact cites the artifact and the line it came from, with the line text as its excerpt.
- Every fact starts `pending`. Only a user decision moves it to `verified` or `rejected`.
- Fact IDs are derived from the profile, kind, key, and value, so re-importing an updated resume lands on the same facts instead of duplicating them.
- Sensitivity is assigned by kind: identity and contact are `pii`, work authorization is `sensitive`, and nothing is ever imported as `secret`.
- Active facts with the same profile, kind, and canonical key but distinct values form a conflict. Every candidate in that conflict is excluded from downstream use until the combined evidence is reviewed.

## Line guards

Before a line is read for content it must pass two guards, and a line that fails is reported by line number and reason only — its text is never copied into a fact, an excerpt, or the report.

- `possible_secret`: the line matches a credential pattern, such as a password, API key, private key block, or card number.
- `line_too_long`: the line exceeds the 2,000-character value limit.

## Sections

Headings are matched against a fixed list: summary, skills, experience, education, projects, certifications, and work authorization. Everything before the first heading is the header block, which yields the name and contact facts.

A heading the extractor does not model starts an `unrecognized` section. Its lines are reported as skipped rather than filed under the previous section, because a wrong section would produce a wrongly typed fact. Unknown headings are only detected when they are short and either all caps or colon-terminated; a title-cased unknown heading can still be absorbed by the section above it, so the import report lists every section that was read.

An employment entry is anchored on a date range. Role and organization are separated only when the header text splits cleanly on a strong separator; otherwise the raw headline is kept so the reviewer sees the original wording instead of a guess.

## Review

`reviewFact` applies one decision to one fact:

- The decision must target that fact and carry `reviewedValueHash`, the digest of the value the reviewer saw. A value that changed after the screen was rendered fails closed.
- Only a `pending` fact can be decided. Replaying the identical decision is idempotent; any other second decision is refused.
- A decision timestamped before the fact's last update is refused.

`mergeImportedFacts` folds a fresh import into the stored facts. An already-decided fact keeps its status, version, and decision record and only gains the new source citation, and a fact missing from the new document is kept, because a missing line is not evidence that a fact became false.

`detectFactConflicts` groups competing active values and binds a review hash to every candidate's status, version, value, and source evidence. `resolveFactConflict` verifies the selected candidate, rejects its alternatives, and returns a durable decision record. A stale hash or a selection outside the reviewed group fails closed. `usableFacts` removes every unresolved conflict candidate before resume generation or browser filling.
