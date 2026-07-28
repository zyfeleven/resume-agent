# Fixture Forms

The controlled application-form lab from [the fixture specification](../../docs/FIXTURE_FORM_SPEC.md). It is a test target, not a job board.

- It runs on a loopback origin and makes no external network request.
- It holds synthetic data only, and fake submission returns a deterministic receipt without sending anything.
- Every control has an accessible label and a stable `data-testid`; the page carries `data-fixture-id` and `data-fixture-revision`.

Start it with:

```bash
npm run dev:fixtures
```

## What is implemented

| ID | Fixture | Status |
|---|---|---|
| `F01` | Basic identity fields | Built |
| `F09` | Sensitive routing (work authorization, compensation, signature) | Built, as marked fields on the F01 page |
| `F10` | Authentication barriers | Marker only, set through `POST /__fixture/signal?value=<signal>` |
| `F13` | Fake submit receipt | Deterministic receipt page |
| `F02`–`F08`, `F11`, `F12` | Choices, uploads, repeats, steps, frames, dynamic DOM, untrusted content, origin change | **Not built.** They are absent rather than faked, and the runner reports what it actually observed |

## Test-only routes

| Route | Behavior |
|---|---|
| `POST /__fixture/reset/<id>` | Return to the exact baseline and report the deterministic seed |
| `POST /__fixture/signal?value=<signal>` | Turn a synthetic safety marker on, so policy routing can be exercised end to end |
| `POST /__fixture/submit` | Deterministic synthetic receipt. Nothing is sent anywhere |
