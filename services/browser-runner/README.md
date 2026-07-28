# Browser Runner

`@resume-agent/browser-runner` drives a local Playwright browser for the dashboard, with the policy engine in front of every tool call.

Phase 1 implements the two read tools — `browser_session_open` and `browser_snapshot` — plus stopping the browser. The write tools (`browser_set_field`, `browser_activate`, `browser_set_file`, `browser_submit`) are **not built**: nothing here can fill a field or submit anything.

It currently runs in the dashboard's own Node process. The `services/` home is where it grows into a separate local process with an MCP boundary; the shape of that boundary is already fixed by the Browser MCP contracts.

## Guarantees

- **The policy engine decides first.** Every call is evaluated before the browser is touched, and an absent or non-automatic decision is a refusal, never a default allow. Refusing an origin costs nothing because no browser process has been launched yet.
- **A field value never leaves the page.** The observation script returns whether a control holds a value, never the value itself, so a raw answer does not enter the runner's memory, its snapshots, or its logs.
- **Locators are server-owned.** Recipes are produced from the runner's own observation and bound to the snapshot they came from. No caller-supplied selector, script, or path is accepted.
- **Requests stay inside the run's allowlist.** The browser context aborts any request to an origin the session was not opened for.
- **Every call is on the record**, allowed or refused, with the route and the reasons the policy engine gave.

## Safety conditions

The runner reads a page's declared condition — a login wall, MFA, CAPTCHA, an unfamiliar widget, untrusted instructions — and hands it to the policy engine unchanged.

Opening a session is allowed even when such a condition is present, because a runner cannot know what a page contains until it has looked at it. The snapshot taken on open records the condition, and every call after that is refused while it stands. That ordering is deliberate and is covered by a test.

## Understanding a field

A real careers page carries no test IDs, no sensitivity markers, and no submit marker. Meaning is read from what the page actually offers, best signal first:

| Signal | Weight | Example |
|---|---|---|
| `autocomplete` token | 0.95 | `given-name` → `first_name` |
| Visible label | 0.90 | "Are you legally authorized to work here?" → `work_authorization` |
| Input type | 0.85 | `type="email"` → `email` |
| Control name or id | 0.70 | `candidate[email]` → `email` |
| Placeholder | 0.60 | "City" → `city` |

The longest matching phrase wins, so "work authorization" beats the bare word "authorization". Signals that agree raise confidence; a genuinely split verdict lowers it and marks the field **contested**, which routes it to a person. One weaker signal differing is not a split — a LinkedIn box is still `type="url"` — and treating that as a conflict would hand back fields the runner does understand.

Confidence is what the policy engine acts on: below 0.90 a field is never automatic, and a control nothing recognizes has no confidence at all.

### Sensitivity comes from meaning

An employer's EEO question announces nothing about itself. Work authorization, sponsorship, compensation, gender, ethnicity, veteran status, disability, criminal history, date of birth, and signature fields are classified sensitive **by what they ask**, so they stay with the person on a site that gives no hint. A page that does mark a field can only raise the classification, never lower it.

## Filling fields

A field is filled only when a **verified fact answers it by name**. The fact's key must equal the field's canonical name exactly: nothing is split, joined, or reformatted, so a resume that never stated a first name separately does not gain one here. That field goes to the person instead.

Every field is then routed by the policy engine, which sees the shape of an answer — sensitivity, provenance, confidence, and how many sources back it — and never the answer itself.

| Route | Meaning |
|---|---|
| `automatic` | A verified fact answers this field and nothing about it is sensitive. |
| `takeover` | The site marks it sensitive, or it carries a protected or legal tag. It stays with the person whether or not a fact could have answered it. |
| `confirmation` | Allowed, but not without the person. |
| `no_answer` | No verified fact names this field. There is nothing truthful to type, so the runner does not claim it is holding a value back. |
| `prohibited` | A submit candidate. It is never part of a fill plan. |

### How a write is made safe

- **The plan is rebuilt against a snapshot taken now**, so a page that changed since it was last observed is planned again rather than written blind.
- **Each write takes a single-use reservation** bound to that snapshot, the target, and the exact value digest. Consuming it twice is refused, and it expires on a lease.
- **The locator comes from the snapshot**, never from a caller. Several recipes are produced per control — test ID, visible label, control name, placeholder — and a write takes the first that still resolves to exactly one control. A recipe matching several is skipped rather than guessed at; if none resolves uniquely the write does not happen.
- **Verification is a digest the page computes.** The written value is compared by SHA-256 calculated inside the page, so a write is confirmed without the answer ever being read back out.
- **There is no submit tool.** Submission is a separate action with its own approval, and this runner does not have it. A write aimed at a submit candidate is refused outright.

## Session model

One session at a time. The dashboard supervises one run, and a run nobody is watching should not exist. `closeSession` is always safe to call, including when nothing is open.
