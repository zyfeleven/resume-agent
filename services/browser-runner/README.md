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
- **The locator comes from the snapshot**, never from a caller, and a target that no longer resolves uniquely fails closed rather than being guessed at.
- **Verification is a digest the page computes.** The written value is compared by SHA-256 calculated inside the page, so a write is confirmed without the answer ever being read back out.
- **There is no submit tool.** Submission is a separate action with its own approval, and this runner does not have it. A write aimed at a submit candidate is refused outright.

## Session model

One session at a time. The dashboard supervises one run, and a run nobody is watching should not exist. `closeSession` is always safe to call, including when nothing is open.
