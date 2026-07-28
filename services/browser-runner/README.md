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

## Session model

One session at a time. The dashboard supervises one run, and a run nobody is watching should not exist. `closeSession` is always safe to call, including when nothing is open.
