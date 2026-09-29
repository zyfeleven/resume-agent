"use client";

import { useCallback, useEffect, useState } from "react";

import type { RunnerPayload } from "../lib/runner-session";

const SENSITIVITY_TONE: Record<string, string> = {
  sensitive: "attention",
  secret: "danger",
  pii: "",
  normal: "",
};

const ROUTE_GROUPS: ReadonlyArray<{ id: string; label: string; note: string }> = [
  { id: "automatic", label: "Filled by the runner", note: "A verified fact answers this field by name" },
  { id: "confirmation", label: "Needs your confirmation", note: "Understood, but not confidently enough to act alone" },
  { id: "takeover", label: "Yours to answer", note: "Sensitive, legal, or protected" },
  { id: "no_answer", label: "No verified fact", note: "Nothing truthful to type" },
  { id: "prohibited", label: "Never automatic", note: "Submission requires its own approval" },
];

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { timeStyle: "medium" });
}

export function RunnerConsole() {
  const [payload, setPayload] = useState<RunnerPayload | null>(null);
  const [busy, setBusy] = useState<"start" | "snapshot" | "stop" | "plan" | "fill" | "ai-plan" | "ai-fill" | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "attention"; text: string } | null>(null);

  const request = useCallback(async (input: string, init?: RequestInit): Promise<boolean> => {
    const response = await fetch(input, init);
    const body: unknown = await response.json().catch(() => null);

    if (body && typeof body === "object" && "fixtureOrigin" in body) {
      setPayload(body as RunnerPayload);
    }
    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string"
          ? (body as { message: string }).message
          : "That request could not be completed.";
      setNotice({ tone: "attention", text: message });
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    void request("/api/runner");
  }, [request]);

  const act = async (action: "start" | "snapshot" | "stop") => {
    setBusy(action);
    setNotice(null);
    const ok = await request(
      action === "snapshot" ? "/api/runner/snapshot" : "/api/runner",
      { method: action === "stop" ? "DELETE" : "POST" },
    );
    if (ok) {
      setNotice({
        tone: "good",
        text:
          action === "start"
            ? "Session open. The page was observed through the policy engine."
            : action === "snapshot"
              ? "Page re-observed."
              : "Session stopped and the browser closed.",
      });
    }
    setBusy(null);
  };

  const runFill = async (action: "plan" | "fill") => {
    setBusy(action);
    setNotice(null);
    const ok = await request(`/api/runner/${action}`, { method: "POST" });
    if (ok) {
      setNotice({
        tone: "good",
        text:
          action === "plan"
            ? "Planned against a snapshot taken just now. Nothing was typed."
            : "Filled the fields policy allows. Every write was verified against the page.",
      });
    }
    setBusy(null);
  };

  const runIntelligentFill = async (action: "plan" | "fill") => {
    const busyAction = `ai-${action}` as "ai-plan" | "ai-fill";
    setBusy(busyAction);
    setNotice(null);
    const ok = await request(`/api/runner/ai/${action}`, { method: "POST" });
    if (ok) {
      setNotice({
        tone: "good",
        text:
          action === "plan"
            ? "Gemini proposed a plan. Every suggestion was rechecked locally and nothing was typed."
            : "Gemini optimized and mapped the safe answers; Playwright filled only those the local policy approved.",
      });
    }
    setBusy(null);
  };

  if (!payload) {
    return (
      <section className="panel">
        <p className="eyebrow">Runner</p>
        <h2>Checking the local runner…</h2>
      </section>
    );
  }

  const { session, snapshot, toolCalls, fixtureReachable, fixtureOrigin, plan, results, answerValues, intelligence, intelligenceRun } = payload;
  const fields = snapshot?.targets.filter((target) => target.kind === "field") ?? [];
  const resultByTarget = new Map((results ?? []).map((result) => [result.targetId, result]));

  return (
    <>
      <section className="workspace-title">
        <div>
          <p className="eyebrow">Browser runner</p>
          <h1>{session ? "Session open" : "Local runner"}</h1>
          <p>
            {session
              ? `${snapshot?.targets.length ?? 0} controls observed · page generation ${session.pageGeneration} · ${session.allowedOrigins.join(", ")}`
              : `Target ${fixtureOrigin} · the runner may touch no other origin`}
          </p>
        </div>
        <div className="workspace-actions">
          <span className={`status-pill ${session ? "good" : ""}`}>{session ? "running" : "stopped"}</span>
          <button className="button primary" disabled={busy !== null || !fixtureReachable || Boolean(session)} onClick={() => void act("start")}>
            {busy === "start" ? "Starting…" : "Start session"}
          </button>
          <button className="button secondary" disabled={busy !== null || !session} onClick={() => void act("snapshot")}>
            {busy === "snapshot" ? "Observing…" : "Re-observe page"}
          </button>
          <button className="button secondary" disabled={busy !== null || !session} onClick={() => void runFill("plan")}>
            {busy === "plan" ? "Planning…" : "Plan fill"}
          </button>
          <button className="button primary" disabled={busy !== null || !session} onClick={() => void runFill("fill")}>
            {busy === "fill" ? "Filling…" : "Fill allowed fields"}
          </button>
          <button
            className="button secondary"
            disabled={busy !== null || !session || !intelligence.configured}
            onClick={() => void runIntelligentFill("plan")}
            title={intelligence.configured ? "Ask Gemini to map and draft safe answers" : "Configure GEMINI_API_KEY on the server first"}
          >
            {busy === "ai-plan" ? "Thinking…" : "AI plan"}
          </button>
          <button
            className="button primary"
            disabled={busy !== null || !session || !intelligence.configured}
            onClick={() => void runIntelligentFill("fill")}
            title={intelligence.configured ? "Ask Gemini, then fill only locally approved answers" : "Configure GEMINI_API_KEY on the server first"}
          >
            {busy === "ai-fill" ? "Optimizing…" : "AI optimize & fill"}
          </button>
          <button className="button secondary" disabled={busy !== null || !session} onClick={() => void act("stop")}>
            {busy === "stop" ? "Stopping…" : "Stop"}
          </button>
        </div>
      </section>

      {notice ? <p className={`import-notice ${notice.tone}`}>{notice.text}</p> : null}

      <section className="panel guard-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Form intelligence</p>
            <h2>Gemini plans; local policy and Playwright execute</h2>
          </div>
          <span className={`status-pill ${intelligence.configured ? "good" : "attention"}`}>
            {intelligence.configured ? intelligence.model : "API key needed for live runs"}
          </span>
        </div>
        <p className="helper-text">
          The key is read only on the server. Gemini receives redacted field metadata, fact identifiers, and only normal-sensitivity
          fact text needed for grounded drafts. PII values stay local for verbatim filling; sensitive, legal, compensation, signature,
          login, MFA, CAPTCHA, and submit actions stay with you.
        </p>
        {intelligenceRun ? (
          <p className="helper-text">
            Last {intelligenceRun.mode}: {intelligenceRun.acceptedCount} of {intelligenceRun.proposedCount} suggestions accepted locally;{" "}
            {intelligenceRun.rejectedCount} rejected
            {intelligenceRun.inputTokens === undefined ? "" : ` · ${intelligenceRun.inputTokens} input tokens`}
            {intelligenceRun.outputTokens === undefined ? "" : ` · ${intelligenceRun.outputTokens} output tokens`}.
          </p>
        ) : null}
      </section>

      {!fixtureReachable ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Fixture form</p>
              <h2>The fixture lab is not running</h2>
            </div>
            <span className="status-pill danger">offline</span>
          </div>
          <p className="helper-text">
            The runner only ever points at the local fixture lab, never a real hiring site. Start it with{" "}
            <code>npm run dev:fixtures</code>, then start a session.
          </p>
        </section>
      ) : null}

      <section className="panel guard-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Policy engine</p>
            <h2>Every tool call is evaluated before the browser is touched</h2>
          </div>
          <span className="count-label">{toolCalls.length} calls</span>
        </div>
        {toolCalls.length === 0 ? (
          <p className="helper-text">No tool call has been made yet.</p>
        ) : (
          <ul className="section-list">
            {toolCalls
              .slice()
              .reverse()
              .map((call, index) => (
                <li key={`${call.tool}-${call.decidedAt}-${index}`}>
                  <span>
                    <code>{call.tool}</code> {formatTime(call.decidedAt)} · {call.reasons.join(", ")}
                  </span>
                  <b className={call.outcome === "refused" ? "muted" : ""}>
                    {call.route}
                    {call.outcome === "refused" ? " · refused" : ""}
                  </b>
                </li>
              ))}
          </ul>
        )}
        <p className="helper-text">
          A refusal is the policy engine stopping the run, not an error. This runner has no submit tool at all:
          submission is a separate action with its own approval, and it is not built.
        </p>
      </section>

      {plan ? (
        <section className="panel facts-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Fill plan</p>
              <h2>What may be filled, field by field</h2>
            </div>
            <span className="count-label">
              {plan.automaticFieldIds.length} of {plan.fields.length} allowed · snapshot{" "}
              {plan.pageFingerprint.slice(0, 10)}…
            </span>
          </div>

          {ROUTE_GROUPS.map((group) => {
            const entries = plan.fields.filter((field) => field.route === group.id);
            if (entries.length === 0) {
              return null;
            }

            return (
              <div className="fact-group" key={group.id}>
                <p className="fact-group-title">
                  {group.label} <b>{entries.length}</b> <i>{group.note}</i>
                </p>
                {entries.map((field) => {
                  const result = resultByTarget.get(field.targetId);
                  const value = field.factId ? answerValues[field.factId] : undefined;

                  return (
                    <div className={`fact-row change-row ${group.id === "automatic" ? "keep" : "remove"}`} key={field.targetId}>
                      <div className="fact-main">
                        <div className="fact-headline">
                          <strong>{field.accessibleName || field.canonicalField}</strong>
                          {field.required ? <span className="status-pill">required</span> : null}
                          {field.sensitivity !== "normal" ? (
                            <span className={`status-pill ${SENSITIVITY_TONE[field.sensitivity] ?? ""}`}>
                              {field.sensitivity}
                            </span>
                          ) : null}
                        </div>
                        {value ? <p className="fact-source">{value}</p> : null}
                        <p className="fact-source">
                          <span className="kind-chip">{field.canonicalField || "unrecognized"}</span>
                          {field.confidence > 0 ? <span>{Math.round(field.confidence * 100)}% sure</span> : null}
                          {field.contested ? <span className="status-pill attention">signals disagree</span> : null}
                          <span>{field.reasons.join(", ").replace(/_/g, " ")}</span>
                        </p>
                        {field.evidence.length > 0 ? (
                          <p className="keyword-row">
                            {field.evidence.map((entry) => (
                              <span key={entry}>{entry}</span>
                            ))}
                          </p>
                        ) : null}
                      </div>
                      <div className="fact-actions">
                        {result ? (
                          <span className={`status-pill ${result.applied ? "good" : "danger"}`}>
                            {result.applied ? "verified on page" : "not verified"}
                          </span>
                        ) : (
                          <span className="status-pill">{group.id === "automatic" ? "ready" : "your call"}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div className="approval-callout">
            <span>!</span>
            <div>
              <strong>The rest of this form is yours</strong>
              <p>
                A field is filled only when a verified fact answers it by name and the policy engine allows it. Anything
                sensitive, unmatched, or low-confidence stays empty for you, and submission is never available here.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {snapshot ? (
        <section className="panel facts-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Page snapshot</p>
              <h2>{snapshot.title}</h2>
            </div>
            <span className="count-label">
              fingerprint {snapshot.pageFingerprint.slice(0, 10)}… · {formatTime(snapshot.observedAt)}
            </span>
          </div>

          <div className="fact-group">
            <p className="fact-group-title">
              Observed controls <b>{snapshot.targets.length}</b> <i>values are never read out of the page</i>
            </p>
            {fields.map((target) => (
              <div className="fact-row" key={target.id}>
                <div className="fact-main">
                  <div className="fact-headline">
                    <strong>{target.accessibleName || target.id}</strong>
                    {target.required ? <span className="status-pill">required</span> : null}
                    {target.sensitivity !== "normal" ? (
                      <span className={`status-pill ${SENSITIVITY_TONE[target.sensitivity] ?? ""}`}>
                        {target.sensitivity}
                      </span>
                    ) : null}
                  </div>
                  <p className="fact-source">
                    <span className="kind-chip">{target.controlType}</span>
                    <span>{target.locatorRecipes[0]?.strategy ?? "locator"}: {target.locatorRecipes[0]?.value}</span>
                  </p>
                </div>
                <div className="fact-actions">
                  <span className="status-pill">{target.observedValue.state}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="approval-callout">
            <span>!</span>
            <div>
              <strong>Observation only</strong>
              <p>
                This snapshot carries structure — roles, names, requiredness — and no raw field values. Filling is a separate,
                policy-gated action. Submission is not implemented.
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
