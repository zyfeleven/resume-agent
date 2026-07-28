"use client";

import { useCallback, useEffect, useState } from "react";

import type { RunnerPayload } from "../lib/runner-session";

const SENSITIVITY_TONE: Record<string, string> = {
  sensitive: "attention",
  secret: "danger",
  pii: "",
  normal: "",
};

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { timeStyle: "medium" });
}

export function RunnerConsole() {
  const [payload, setPayload] = useState<RunnerPayload | null>(null);
  const [busy, setBusy] = useState<"start" | "snapshot" | "stop" | null>(null);
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

  if (!payload) {
    return (
      <section className="panel">
        <p className="eyebrow">Runner</p>
        <h2>Checking the local runner…</h2>
      </section>
    );
  }

  const { session, snapshot, toolCalls, fixtureReachable, fixtureOrigin } = payload;
  const fields = snapshot?.targets.filter((target) => target.kind === "field") ?? [];

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
          <button className="button secondary" disabled={busy !== null || !session} onClick={() => void act("stop")}>
            {busy === "stop" ? "Stopping…" : "Stop"}
          </button>
        </div>
      </section>

      {notice ? <p className={`import-notice ${notice.tone}`}>{notice.text}</p> : null}

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
          A refusal is the policy engine stopping the run, not an error. Nothing here can fill a field or submit
          anything: those tools are not built yet.
        </p>
      </section>

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
                This snapshot carries structure — roles, names, requiredness — and no field values. Filling fields and
                submitting are separate tools with their own approval, and neither exists yet.
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
