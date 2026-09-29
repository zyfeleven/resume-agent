"use client";

import type { AuditEvent } from "@resume-agent/contracts";
import { useCallback, useEffect, useState } from "react";

import type { AuditTimeline as Timeline } from "../lib/audit-store";

const ACTOR_LABELS: Record<AuditEvent["actorType"], string> = {
  user: "you",
  agent: "the agent",
  service: "a local service",
  policy_engine: "the policy engine",
};

const EVENT_LABELS: Record<string, string> = {
  "profile.resume_imported": "Imported a resume",
  "profile.fact_reviewed": "Decided a fact",
  "profile.local_data_deleted": "Deleted profile data",
  "job.description_parsed": "Parsed a job description",
  "jobs.local_data_deleted": "Deleted job data",
  "resume.content_approved": "Approved resume content",
  "resume.document_built": "Built a document",
  "browser.browser_session_open": "Opened a browser session",
  "browser.browser_snapshot": "Observed the page",
  "browser.browser_set_field": "Wrote a field",
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

function toneOf(event: AuditEvent): string {
  const outcome = event.payload.outcome;
  if (outcome === "refused" || event.payload.verified === false) {
    return "danger";
  }
  const route = event.payload.route;
  return route === "takeover" || route === "confirmation" ? "attention" : "";
}

export function AuditTimeline() {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/audit");
    setTimeline((await response.json()) as Timeline);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onClear = async () => {
    if (!window.confirm("Delete the whole activity timeline?")) {
      return;
    }
    setBusy(true);
    await fetch("/api/audit", { method: "DELETE" });
    await load();
    setBusy(false);
  };

  if (!timeline) {
    return (
      <section className="panel">
        <p className="eyebrow">Activity</p>
        <h2>Reading the timeline…</h2>
      </section>
    );
  }

  const { events, verification } = timeline;

  return (
    <>
      <section className="workspace-title">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>What happened, and in what order</h1>
          <p>
            {verification.length === 0
              ? "Nothing has been recorded yet."
              : `${verification.length} events recorded · every one carries the digest of the one before it`}
          </p>
        </div>
        <div className="workspace-actions">
          <span className={`status-pill ${verification.intact ? "good" : "danger"}`}>
            {verification.intact ? "chain intact" : "chain broken"}
          </span>
          {events.length > 0 ? (
            <button className="button secondary" disabled={busy} onClick={() => void onClear()}>
              Delete timeline
            </button>
          ) : null}
        </div>
      </section>

      {!verification.intact ? (
        <section className="panel guard-panel failed">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Chain verification</p>
              <h2>This timeline can no longer be trusted</h2>
            </div>
            <span className="status-pill danger">event {(verification.brokenAt ?? 0) + 1}</span>
          </div>
          <p className="helper-text">{verification.reason}</p>
        </section>
      ) : null}

      <section className="panel facts-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Timeline</p>
            <h2>Newest first</h2>
          </div>
          <span className="count-label">values and secrets are never recorded</span>
        </div>

        {events.length === 0 ? (
          <p className="helper-text">
            Import a resume, parse a job description, or start the runner, and every decision taken on your behalf will
            appear here.
          </p>
        ) : null}

        {events.map((event) => (
          <div className={`fact-row change-row ${toneOf(event)}`} key={event.id}>
            <div className="fact-main">
              <div className="fact-headline">
                <strong>{EVENT_LABELS[event.eventType] ?? event.eventType}</strong>
                <span className="status-pill">{ACTOR_LABELS[event.actorType]}</span>
                {typeof event.payload.route === "string" ? (
                  <span className={`status-pill ${toneOf(event)}`}>{String(event.payload.route)}</span>
                ) : null}
              </div>
              <p className="fact-source">
                <span>{formatTime(event.occurredAt)}</span>
                <span className="kind-chip">{event.eventType}</span>
              </p>
              <p className="keyword-row">
                {Object.entries(event.payload)
                  .filter(([key]) => key !== "route")
                  .map(([key, value]) => (
                    <span key={key}>
                      {key}: {Array.isArray(value) ? value.join(", ") : String(value)}
                    </span>
                  ))}
              </p>
            </div>
            <div className="fact-actions">
              <span className="kind-chip">{event.eventHash.slice(0, 8)}</span>
            </div>
          </div>
        ))}

        <div className="approval-callout">
          <span>!</span>
          <div>
            <strong>What this timeline may contain</strong>
            <p>
              Identifiers, hashes, counts, and the reasons a decision went the way it did. A payload carrying an email
              address, a phone number, a credential, or free text is refused at the point of writing, so nothing you
              typed can be recovered from here.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
