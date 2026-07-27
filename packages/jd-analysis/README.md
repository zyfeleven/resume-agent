# JD Analysis

`@resume-agent/jd-analysis` turns a pasted job description into structured requirements, and applies the reviewer's corrections to them.

## Guarantees

- The parser is pure and deterministic: no clock, no randomness, no network, no model call, and no file or URL access. The caller supplies the text, the artifact identity, and the parse timestamp.
- Requirement text is the posting's own wording. Nothing is paraphrased, summarized, or inferred, and every keyword is a substring of the requirement it belongs to.
- Every requirement cites the line it came from.
- Requirement IDs are derived from the job and the requirement text, so re-parsing an unchanged posting produces the same IDs.
- The job title and company are supplied by the user, not guessed from the text.

## Untrusted input

A job posting is untrusted input. The parser reads it as data and never as instructions, and two line guards run before any text becomes a requirement. A line that fails is reported by line number and reason only — its wording never reaches a requirement, an excerpt, or the report, so it cannot travel into a later prompt.

- `possible_injection`: the line addresses the agent, for example by trying to override earlier instructions or claiming to be a system message.
- `possible_secret`: the line matches a credential pattern.

Lines are also skipped as `line_too_long`, `not_a_requirement` (too short, or intro prose that states no requirement), `duplicate_requirement`, or `non_requirement_section`.

## Priority

Priority comes from document structure rather than a judgement about the employer's intent:

- A `requirements` section yields `must_have`, a `preferred` section yields `preferred`, and a `responsibilities` section yields `context`.
- An in-line marker such as "is a plus" or "nice to have" can lower a requirement to `preferred`. A marker may only raise a requirement where the section itself states no priority, so an explicit section is never overruled by a stray word.
- Benefits, company, and legal sections yield nothing.
- An unrecognized heading is treated as a sub-heading of the section above it and inherits that priority, because dropping its lines would lose real requirements. The report lists it as `unrecognized` so the classification can be checked.
- A posting with no headings at all still yields requirements from its list items and from lines that state their own priority.

## Kind

`kind` is classified from wording, in order: education, credential, an explicit duration (`experience`), a stated proficiency (`skill`), a working-style trait (`behavior`), a general mention of past work (`experience`), then `other`. Lines under a responsibilities section are always `responsibility`.

## Review

`applyRequirementReview` applies one correction: `set_priority`, `set_kind`, or `dismiss`. Corrections never rewrite requirement text — a requirement ID is derived from its text, so changed wording is a different requirement entirely, and a decision can never land on text the reviewer did not see.
