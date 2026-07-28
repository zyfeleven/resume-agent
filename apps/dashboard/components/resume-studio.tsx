"use client";

import { useCallback, useEffect, useState } from "react";

import type { ChangeView } from "../lib/resume-payload";
import type { ResumeStatePayload } from "../lib/resume-view";

const STRENGTH_LABELS: Record<string, string> = {
  exact: "backed",
  related: "partly backed",
  missing: "no fact",
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ResumeStudio() {
  const [payload, setPayload] = useState<ResumeStatePayload | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [busyChangeId, setBusyChangeId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "attention"; text: string } | null>(null);

  const request = useCallback(async (input: string, init?: RequestInit): Promise<ResumeStatePayload | null> => {
    const response = await fetch(input, init);
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string"
          ? (body as { message: string }).message
          : "That request could not be completed.";
      setNotice({ tone: "attention", text: message });
      return null;
    }

    const next = body as ResumeStatePayload;
    setPayload(next);
    return next;
  }, []);

  useEffect(() => {
    void request("/api/resume");
  }, [request]);

  const onGenerate = async () => {
    const jobId = selectedJobId || payload?.tailored?.job.id || payload?.jobs[0]?.id;
    if (!jobId) {
      return;
    }

    setGenerating(true);
    setNotice(null);
    const next = await request("/api/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    if (next?.tailored) {
      setSelectedJobId(next.tailored.job.id);
      setNotice({
        tone: next.tailored.guard?.passed === false ? "attention" : "good",
        text:
          next.tailored.guard?.passed === false
            ? "The claim guard blocked this change set. Nothing here is approvable."
            : "Every proposed change cites the verified facts and requirements behind it.",
      });
    }
    setGenerating(false);
  };

  const onDecide = async (view: ChangeView, decision: "approved" | "rejected") => {
    if (!payload?.tailored) {
      return;
    }
    setBusyChangeId(view.change.id);
    await request(`/api/resume/changes/${encodeURIComponent(view.change.id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        changeSetId: payload.tailored.changeSetId,
        decision,
        reviewedChangeHash: view.reviewHash,
      }),
    });
    setBusyChangeId(null);
  };

  const onApprove = async () => {
    if (!payload?.tailored) {
      return;
    }
    setApproving(true);
    setNotice(null);
    const next = await request("/api/resume/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeSetId: payload.tailored.changeSetId }),
    });
    if (next?.approval) {
      setNotice({ tone: "good", text: "Content approved. The document will be built from exactly this content." });
    }
    setApproving(false);
  };

  const onBuild = async () => {
    if (!payload?.tailored) {
      return;
    }
    setBuilding(true);
    setNotice(null);
    const next = await request("/api/resume/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeSetId: payload.tailored.changeSetId }),
    });
    if (next?.document) {
      setNotice(
        next.document.report?.passed
          ? { tone: "good", text: "Document built and verified against the approved content." }
          : { tone: "attention", text: "The document failed verification and will not be served for download." },
      );
    }
    setBuilding(false);
  };

  const onClear = async () => {
    if (!window.confirm("Delete every generated resume version and change set?")) {
      return;
    }
    const next = await request("/api/resume", { method: "DELETE" });
    if (next) {
      setNotice({ tone: "good", text: "Local resume data deleted." });
    }
  };

  if (!payload) {
    return (
      <section className="panel">
        <p className="eyebrow">Resume studio</p>
        <h2>Loading your local resume data…</h2>
      </section>
    );
  }

  const { tailored, jobs, verifiedFactCount } = payload;
  const guardFailed = tailored?.guard?.passed === false;
  const missingCoverage = tailored?.coverage.filter((entry) => entry.strength === "missing") ?? [];
  const changesBySection = new Map<string, ChangeView[]>();
  for (const view of tailored?.changes ?? []) {
    changesBySection.set(view.section, [...(changesBySection.get(view.section) ?? []), view]);
  }

  return (
    <>
      <section className="workspace-title">
        <div>
          <p className="eyebrow">Resume studio</p>
          <h1>{tailored ? `${tailored.job.title} · ${tailored.job.company}` : "Tailor a resume"}</h1>
          <p>
            {tailored
              ? `${tailored.keptItemCount} lines kept · ${tailored.removedItemCount} removed · ${tailored.pendingChangeIds.length} still unreviewed`
              : `${verifiedFactCount} verified facts available. Every line comes from one of them.`}
          </p>
        </div>
        <div className="workspace-actions">
          {jobs.length > 0 ? (
            <select
              aria-label="Job to tailor for"
              value={selectedJobId || tailored?.job.id || jobs[0]?.id || ""}
              onChange={(event) => setSelectedJobId(event.target.value)}
            >
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title} · {job.company}
                </option>
              ))}
            </select>
          ) : null}
          <button className="button primary" disabled={generating || jobs.length === 0} onClick={() => void onGenerate()}>
            {generating ? "Generating…" : tailored ? "Regenerate" : "Generate change set"}
          </button>
          {tailored ? (
            <button className="button secondary" onClick={() => void onClear()}>
              Delete local data
            </button>
          ) : null}
        </div>
      </section>

      {notice ? <p className={`import-notice ${notice.tone}`}>{notice.text}</p> : null}

      {jobs.length === 0 ? (
        <section className="panel">
          <p className="helper-text">
            Add a job description in <a href="/jobs">Jobs</a> first. A resume is tailored against the requirements of one
            posting.
          </p>
        </section>
      ) : null}

      {payload.blocked ? (
        <section className="panel">
          <p className="helper-text">{payload.blocked.reason}</p>
        </section>
      ) : null}

      {tailored ? (
        <>
          {guardFailed ? (
            <section className="panel guard-panel failed">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Claim guard</p>
                  <h2>This change set is blocked</h2>
                </div>
                <span className="status-pill danger">{tailored.guard?.violations.length} violations</span>
              </div>
              <ul className="violation-list">
                {tailored.guard?.violations.map((violation, index) => (
                  <li key={`${violation.code}-${index}`}>
                    <b>{violation.code.replace(/_/g, " ")}</b>
                    {violation.detail}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="panel guard-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Claim guard</p>
                  <h2>Every line traces to a verified fact</h2>
                </div>
                <span className="status-pill good">passed</span>
              </div>
              <p className="helper-text">
                Checked {formatTime(tailored.guard?.checkedAt ?? tailored.generatedAt)} · generator{" "}
                <code>{tailored.model}</code> · this step selects from your facts and writes no new prose.
              </p>
            </section>
          )}

          <section className="panel coverage-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Requirement coverage</p>
                <h2>What this posting asks for</h2>
              </div>
              <span className="count-label">{tailored.coverage.length} requirements</span>
            </div>
            <ul className="coverage-list">
              {tailored.coverage.map((entry) => (
                <li key={entry.requirementId} className={entry.strength}>
                  <div>
                    <strong>{entry.text}</strong>
                    {entry.factValues.length > 0 ? <p>{entry.factValues.slice(0, 3).join(" · ")}</p> : null}
                  </div>
                  <span className={`status-pill ${entry.strength === "missing" ? "danger" : entry.strength === "exact" ? "good" : "attention"}`}>
                    {STRENGTH_LABELS[entry.strength]}
                  </span>
                </li>
              ))}
            </ul>
            {missingCoverage.length > 0 ? (
              <p className="helper-text">
                {missingCoverage.length} requirement(s) have no verified fact behind them. Nothing was written to claim
                them — verify a fact that covers them, or leave the gap honest.
              </p>
            ) : null}
          </section>

          <section className="panel facts-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Proposed change set</p>
                <h2>Approve what belongs in this resume</h2>
              </div>
              <span className="count-label">{tailored.changes.length} changes</span>
            </div>

            {[...changesBySection.entries()].map(([section, views]) => (
              <div className="fact-group" key={section}>
                <p className="fact-group-title">
                  {section} <b>{views.length}</b>
                </p>
                {views.map((view) => (
                  <div className={`fact-row change-row ${view.change.intent}`} key={view.change.id}>
                    <div className="fact-main">
                      <div className="fact-headline">
                        <span className={`intent-chip ${view.change.intent}`}>{view.change.intent}</span>
                        <strong>{Array.isArray(view.change.before) ? view.change.before.join(" / ") : view.change.before}</strong>
                      </div>
                      <p className="fact-source">{view.change.rationale}</p>
                      {view.requirementTexts.length > 0 ? (
                        <p className="keyword-row">
                          {view.requirementTexts.slice(0, 3).map((text) => (
                            <span key={text}>{text.slice(0, 70)}</span>
                          ))}
                        </p>
                      ) : null}
                    </div>
                    <div className="fact-actions">
                      {view.decision ? (
                        <span className={`status-pill ${view.decision === "approved" ? "good" : "danger"}`}>
                          {view.decision}
                        </span>
                      ) : null}
                      <button
                        className="button primary"
                        disabled={busyChangeId === view.change.id || guardFailed || view.decision === "approved"}
                        onClick={() => void onDecide(view, "approved")}
                      >
                        Approve
                      </button>
                      <button
                        className="text-button"
                        disabled={busyChangeId === view.change.id || guardFailed || view.decision === "rejected"}
                        onClick={() => void onDecide(view, "rejected")}
                      >
                        {view.change.intent === "remove" ? "Keep it" : "Drop it"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}

            <div className="approval-callout">
              <span>!</span>
              <div>
                <strong>Nothing is finalized here</strong>
                <p>
                  {tailored.pendingChangeIds.length > 0
                    ? `${tailored.pendingChangeIds.length} change(s) are still unreviewed. A resume version cannot be approved while any change is undecided.`
                    : "Every change is decided. Approving freezes this content; the document is then built from that approval alone."}
                </p>
              </div>
            </div>
          </section>

          <section className="panel document-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Step 3</p>
                <h2>{payload.document ? "Your tailored document" : "Approve, then build the document"}</h2>
              </div>
              <span className={`status-pill ${payload.versionStatus === "docx_built" ? "good" : payload.approval ? "attention" : ""}`}>
                {payload.versionStatus ? payload.versionStatus.replace(/_/g, " ") : "draft"}
              </span>
            </div>

            <div className="document-actions">
              <button
                className="button primary"
                disabled={approving || guardFailed || tailored.pendingChangeIds.length > 0 || Boolean(payload.approval)}
                onClick={() => void onApprove()}
              >
                {approving ? "Approving…" : payload.approval ? "Content approved" : "Approve content"}
              </button>
              <button
                className="button secondary"
                disabled={building || !payload.approval}
                onClick={() => void onBuild()}
              >
                {building ? "Building…" : payload.document ? "Rebuild document" : "Build DOCX"}
              </button>
              {payload.document?.report?.passed ? (
                <a className="button secondary" href={payload.document.downloadUrl} download={payload.document.fileName}>
                  Download .docx
                </a>
              ) : null}
            </div>

            {payload.approval ? (
              <p className="helper-text">
                Approved {formatTime(payload.approval.decidedAt)} · content{" "}
                <code>{payload.approval.approvedContentHash.slice(0, 12)}…</code>
              </p>
            ) : (
              <p className="helper-text">
                Approval freezes the reviewed content. The builder reads that approval alone, so a document can always be
                traced back to what you approved.
              </p>
            )}

            {payload.document ? (
              <>
                <div className="report-stats">
                  <div>
                    <strong>{payload.document.build.blocks.length}</strong>
                    <span>lines written</span>
                  </div>
                  <div>
                    <strong>{Math.round(payload.document.build.outputByteSize / 1024)}</strong>
                    <span>KB</span>
                  </div>
                  <div>
                    <strong>{payload.document.report?.passed ? "verified" : "failed"}</strong>
                    <span>read back from disk</span>
                  </div>
                </div>

                {payload.document.report && !payload.document.report.passed ? (
                  <ul className="violation-list">
                    {payload.document.report.failures.map((failure, index) => (
                      <li key={`${failure.code}-${index}`}>
                        <b>{failure.code.replace(/_/g, " ")}</b>
                        {failure.detail}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="document-preview" aria-label="Document preview">
                    {payload.document.build.blocks.map((block) => (
                      <p className={`doc-${block.style}`} key={block.blockId}>
                        {block.style === "bullet" ? `• ${block.text}` : block.text}
                      </p>
                    ))}
                  </div>
                )}

                <p className="helper-text">
                  Document hash <code>{payload.document.build.outputHash.slice(0, 12)}…</code> · built from approved
                  content <code>{payload.document.build.approvedContentHash.slice(0, 12)}…</code> · every line above cites
                  the verified facts it came from.
                </p>
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}
