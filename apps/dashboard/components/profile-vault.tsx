"use client";

import type { Fact } from "@resume-agent/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ProfilePayload } from "../lib/profile-payload";

type StatusFilter = "pending" | "verified" | "rejected" | "all";

const FILTERS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: "pending", label: "Needs review" },
  { id: "verified", label: "Verified" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

const KIND_LABELS: Record<Fact["kind"], string> = {
  identity: "Identity",
  contact: "Contact",
  employment: "Experience",
  achievement: "Achievements",
  skill: "Skills",
  education: "Education",
  project: "Projects",
  credential: "Credentials",
  preference: "Preferences",
  work_authorization: "Work authorization",
};

const KIND_ORDER: ReadonlyArray<Fact["kind"]> = [
  "identity",
  "contact",
  "work_authorization",
  "employment",
  "achievement",
  "skill",
  "education",
  "project",
  "credential",
  "preference",
];

const SKIP_LABELS: Record<string, string> = {
  possible_secret: "looked like a credential",
  duplicate_fact: "already imported",
  line_too_long: "too long to import",
  unattached_bullet: "bullet with no entry",
  unrecognized_line: "section not imported",
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function factValue(fact: Fact): string {
  return typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
}

function sourceLine(fact: Fact): string {
  return fact.sources.map((source) => source.locator.replace("line:", "line ")).join(", ");
}

export function ProfileVault() {
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [busyFactId, setBusyFactId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ factId: string; reason: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "attention"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const request = useCallback(async (input: string, init?: RequestInit): Promise<boolean> => {
    const response = await fetch(input, init);
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string"
          ? (body as { message: string }).message
          : "That request could not be completed.";
      setNotice({ tone: "attention", text: message });
      return false;
    }

    setPayload(body as ProfilePayload);
    return true;
  }, []);

  useEffect(() => {
    void request("/api/profile");
  }, [request]);

  const onImport = async (file: File) => {
    setImporting(true);
    setNotice(null);
    const form = new FormData();
    form.append("file", file);

    const ok = await request("/api/profile/import", { method: "POST", body: form });
    if (ok) {
      setFilter("pending");
      setNotice({ tone: "good", text: `Imported ${file.name}. Every extracted fact is pending until you verify it.` });
    }
    setImporting(false);
    if (fileInput.current) {
      fileInput.current.value = "";
    }
  };

  const onDecide = async (fact: Fact, decision: "verify" | "reject", reason?: string) => {
    const reviewedValueHash = payload?.reviewHashes[fact.id];
    if (!reviewedValueHash) {
      setNotice({ tone: "attention", text: "Reload the page before reviewing this fact." });
      return;
    }

    setBusyFactId(fact.id);
    const ok = await request(`/api/profile/facts/${encodeURIComponent(fact.id)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decision === "verify" ? { decision, reviewedValueHash } : { decision, reviewedValueHash, reason }),
    });
    if (ok) {
      setRejecting(null);
      setNotice(null);
    }
    setBusyFactId(null);
  };

  const onClear = async () => {
    if (!window.confirm("Delete every imported fact and the stored resume file from this device?")) {
      return;
    }
    const ok = await request("/api/profile", { method: "DELETE" });
    if (ok) {
      setNotice({ tone: "good", text: "Local profile data deleted." });
    }
  };

  if (!payload) {
    return (
      <section className="panel">
        <p className="eyebrow">Profile vault</p>
        <h2>Loading your local facts…</h2>
      </section>
    );
  }

  const { facts, summary, sources } = payload;
  const visible = facts.filter((fact) => filter === "all" || fact.status === filter);
  const grouped = KIND_ORDER.map((kind) => ({ kind, items: visible.filter((fact) => fact.kind === kind) })).filter(
    (group) => group.items.length > 0,
  );
  const latest = sources[0];

  return (
    <>
      <section className="workspace-title">
        <div>
          <p className="eyebrow">Profile vault</p>
          <h1>{payload.displayName ?? "Import your master resume"}</h1>
          <p>
            {facts.length === 0
              ? "Nothing is imported yet. Facts stay on this device and start as pending."
              : `${summary.pending} pending · ${summary.verified} verified · ${summary.rejected} rejected`}
          </p>
        </div>
        <div className="workspace-actions">
          <span className={`status-pill ${summary.pending > 0 ? "attention" : "good"}`}>
            {summary.pending > 0 ? `${summary.pending} to review` : "Review complete"}
          </span>
          {facts.length > 0 ? (
            <button className="button secondary" onClick={() => void onClear()}>
              Delete local data
            </button>
          ) : null}
        </div>
      </section>

      <section className="import-grid">
        <article className="panel import-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>Import one master resume</h2>
            </div>
            <span className="count-label">.docx, .txt, .md</span>
          </div>
          <p className="helper-text">
            The file is parsed on this device. No content is sent to a hiring site, and lines that look like a credential
            are dropped before anything is stored.
          </p>
          <label className={`dropzone ${importing ? "busy" : ""}`}>
            <input
              ref={fileInput}
              type="file"
              accept=".docx,.txt,.md"
              disabled={importing}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void onImport(file);
                }
              }}
            />
            <strong>{importing ? "Reading the document…" : "Choose a resume file"}</strong>
            <span>Re-importing an updated resume keeps the decisions you already made.</span>
          </label>
          {notice ? <p className={`import-notice ${notice.tone}`}>{notice.text}</p> : null}
        </article>

        <article className="panel report-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Extraction report</p>
              <h2>{latest ? latest.fileName : "No source yet"}</h2>
            </div>
            {latest ? <span className="count-label">{formatTime(latest.importedAt)}</span> : null}
          </div>
          {latest ? (
            <>
              <div className="report-stats">
                <div>
                  <strong>{latest.factCount}</strong>
                  <span>facts found</span>
                </div>
                <div>
                  <strong>{latest.sections.length}</strong>
                  <span>sections read</span>
                </div>
                <div>
                  <strong>{latest.skippedCount}</strong>
                  <span>lines skipped</span>
                </div>
              </div>
              <ul className="section-list">
                {latest.sections.map((section) => (
                  <li key={`${section.kind}-${section.startLine}`}>
                    <span>{section.heading ?? "Header block"}</span>
                    <b className={section.kind === "unrecognized" ? "muted" : ""}>
                      {section.kind === "unrecognized" ? "not imported" : section.kind.replace("_", " ")}
                    </b>
                  </li>
                ))}
              </ul>
              {latest.skipped.length > 0 ? (
                <p className="helper-text">
                  Skipped:{" "}
                  {latest.skipped
                    .map((entry) => `line ${entry.line} (${SKIP_LABELS[entry.reason] ?? entry.reason})`)
                    .join(", ")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="helper-text">
              After an import you will see which sections were read, which lines were skipped, and why.
            </p>
          )}
        </article>
      </section>

      <section className="panel facts-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 2</p>
            <h2>Verify what the agent may use</h2>
          </div>
          <div className="filter-tabs">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                className={filter === option.id ? "active" : ""}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {grouped.length === 0 ? (
          <p className="helper-text">
            {facts.length === 0 ? "Import a resume to see extracted facts here." : "Nothing matches this filter."}
          </p>
        ) : null}

        {grouped.map((group) => (
          <div className="fact-group" key={group.kind}>
            <p className="fact-group-title">
              {KIND_LABELS[group.kind]} <b>{group.items.length}</b>
            </p>
            {group.items.map((fact) => (
              <div className={`fact-row ${fact.status}`} key={fact.id}>
                <div className="fact-main">
                  <div className="fact-headline">
                    <strong>{factValue(fact)}</strong>
                    {fact.sensitivity !== "normal" ? (
                      <span className={`status-pill ${fact.sensitivity === "sensitive" ? "attention" : ""}`}>
                        {fact.sensitivity === "sensitive" ? "sensitive" : "personal"}
                      </span>
                    ) : null}
                  </div>
                  <p className="fact-key">{fact.key}</p>
                  <p className="fact-source">
                    <span>{sourceLine(fact)}</span>
                    {fact.sources[0]?.excerpt ? <q>{fact.sources[0].excerpt}</q> : null}
                  </p>
                  {fact.status === "rejected" ? <p className="fact-decision">Rejected: {fact.rejection.reason}</p> : null}
                  {fact.status === "verified" ? (
                    <p className="fact-decision">Verified {formatTime(fact.verification.verifiedAt)}</p>
                  ) : null}
                </div>

                <div className="fact-actions">
                  {fact.status === "pending" ? (
                    rejecting?.factId === fact.id ? (
                      <form
                        className="reject-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void onDecide(fact, "reject", rejecting.reason.trim());
                        }}
                      >
                        <input
                          autoFocus
                          value={rejecting.reason}
                          placeholder="Why is this wrong?"
                          onChange={(event) => setRejecting({ factId: fact.id, reason: event.target.value })}
                        />
                        <button className="button secondary" type="submit" disabled={rejecting.reason.trim().length === 0}>
                          Confirm
                        </button>
                        <button className="text-button" type="button" onClick={() => setRejecting(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          className="button primary"
                          disabled={busyFactId === fact.id}
                          onClick={() => void onDecide(fact, "verify")}
                        >
                          Verify
                        </button>
                        <button className="text-button" onClick={() => setRejecting({ factId: fact.id, reason: "" })}>
                          Reject
                        </button>
                      </>
                    )
                  ) : (
                    <span className={`status-pill ${fact.status === "verified" ? "good" : "danger"}`}>{fact.status}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

        <div className="approval-callout">
          <span>!</span>
          <div>
            <strong>Pending facts are not usable yet</strong>
            <p>
              Resume tailoring and form filling only draw on verified facts. Sensitive answers still require you, even
              after verification.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
