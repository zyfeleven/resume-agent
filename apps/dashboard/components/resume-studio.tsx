"use client";

import { useCallback, useEffect, useState } from "react";

import type { ChangeView, SentenceChangeView } from "../lib/resume-payload";
import type { ResumeStatePayload } from "../lib/resume-view";

const STRENGTH_LABELS: Record<string, string> = {
  exact: "backed",
  related: "partly backed",
  missing: "no fact",
  conflict: "disputed",
};

const BASIS_LABELS: Record<string, string> = {
  keyword: "stated keyword",
  term_overlap: "shared terms",
  term_and_duration: "shared term + duration",
  semantic_model: "Gemini semantic evidence",
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ResumeStudio() {
  const [payload, setPayload] = useState<ResumeStatePayload | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [generating, setGenerating] = useState<"local" | "ai" | null>(null);
  const [approving, setApproving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [busySentenceId, setBusySentenceId] = useState<string | null>(null);
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
    const changeSetId = new URLSearchParams(window.location.search).get("changeSetId");
    void request(changeSetId ? `/api/resume?changeSetId=${encodeURIComponent(changeSetId)}` : "/api/resume");
  }, [request]);

  const onGenerate = async (mode: "local" | "ai") => {
    const jobId = selectedJobId || payload?.tailored?.job.id || payload?.jobs[0]?.id;
    if (!jobId) {
      return;
    }

    setGenerating(mode);
    setNotice(null);
    const next = await request(mode === "ai" ? "/api/resume/ai" : "/api/resume", {
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
            : mode === "ai"
              ? "Gemini matched by meaning and proposed fact-grounded wording. Review every sentence before approval."
              : "Every proposed change cites the verified facts and requirements behind it.",
      });
    }
    setGenerating(null);
  };

  const onDecideSentence = async (
    change: ChangeView,
    view: SentenceChangeView,
    decision: "approved" | "rejected",
  ) => {
    if (!payload?.tailored) {
      return;
    }
    setBusySentenceId(view.sentence.id);
    await request(
      `/api/resume/changes/${encodeURIComponent(change.change.id)}/sentences/${encodeURIComponent(view.sentence.id)}`,
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        changeSetId: payload.tailored.changeSetId,
        decision,
          reviewedSentenceHash: view.reviewHash,
      }),
      },
    );
    setBusySentenceId(null);
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
          ? { tone: "good", text: "Document passed content, package, privacy, render, and visual QA." }
          : { tone: "attention", text: "The document failed a delivery gate and will not be served for download." },
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

  const onRestoreVersion = async (versionId: string) => {
    setRestoringVersionId(versionId);
    setNotice(null);
    const next = await request(`/api/resume/versions/${encodeURIComponent(versionId)}/restore`, {
      method: "POST",
    });
    if (next?.tailored) {
      setSelectedJobId(next.tailored.job.id);
      setNotice({
        tone: "good",
        text: "The approved version is active again. Its original approval and lineage were preserved.",
      });
    }
    setRestoringVersionId(null);
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
  const guardReports = tailored ? [tailored.guard, tailored.semanticGuard].filter(Boolean) : [];
  const guardFailed = tailored
    ? tailored.guard?.passed !== true || tailored.semanticGuard?.passed !== true
    : false;
  const unsupportedCoverage = tailored?.coverage.filter(
    (entry) => entry.strength === "missing" || entry.strength === "conflict",
  ) ?? [];
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
          <button className="button secondary" disabled={generating !== null || jobs.length === 0} onClick={() => void onGenerate("local")}>
            {generating === "local" ? "Matching locally…" : tailored ? "Regenerate locally" : "Generate locally"}
          </button>
          <button
            className="button primary"
            disabled={generating !== null || jobs.length === 0 || !payload.intelligence.configured}
            onClick={() => void onGenerate("ai")}
            title={payload.intelligence.configured ? "Use Gemini semantic matching and grounded rewriting" : "Configure GEMINI_API_KEY on the server first"}
          >
            {generating === "ai" ? "Optimizing with Gemini…" : "AI optimize resume"}
          </button>
          {tailored ? (
            <button className="button secondary" onClick={() => void onClear()}>
              Delete local data
            </button>
          ) : null}
        </div>
      </section>

      {notice ? <p className={`import-notice ${notice.tone}`}>{notice.text}</p> : null}

      <section className="panel guard-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Semantic tailoring</p>
            <h2>Gemini understands relevance; local guards decide what is allowed</h2>
          </div>
          <span className={`status-pill ${payload.intelligence.configured ? "good" : "attention"}`}>
            {payload.intelligence.configured ? payload.intelligence.model : "API key needed for AI optimization"}
          </span>
        </div>
        <p className="helper-text">
          Gemini may match requirements by meaning and suggest clearer wording, but it receives only verified normal-sensitivity
          facts. Every suggestion must preserve cited facts, numbers, responsibility, and proficiency, then pass both claim guards
          and your existing sentence-by-sentence review before approval.
        </p>
      </section>

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

      {payload.versionHistory.length > 0 ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Version history</p>
              <h2>Approved snapshots</h2>
            </div>
            <span className="status-pill">{payload.versionHistory.length} saved</span>
          </div>
          <ul className="violation-list">
            {payload.versionHistory.map((version) => (
              <li key={version.id}>
                <b>{version.job ? `${version.job.title} · ${version.job.company}` : "Stored resume"}</b>
                <span>
                  Approved {formatTime(version.createdAt)} · <code>{version.contentHash.slice(0, 12)}…</code>
                  {version.lastRestoredAt ? ` · restored ${formatTime(version.lastRestoredAt)}` : ""}
                </span>
                <button
                  className="button secondary"
                  disabled={version.active || restoringVersionId !== null}
                  onClick={() => void onRestoreVersion(version.id)}
                >
                  {version.active
                    ? "Active version"
                    : restoringVersionId === version.id
                      ? "Restoring…"
                      : "Restore version"}
                </button>
              </li>
            ))}
          </ul>
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
                <span className="status-pill danger">
                  {guardReports.reduce((count, report) => count + (report?.violations.length ?? 0), 0)} violations
                </span>
              </div>
              <ul className="violation-list">
                {guardReports.flatMap((report) =>
                  (report?.violations ?? []).map((violation, index) => (
                    <li key={`${report?.layer}-${violation.code}-${index}`}>
                      <b>{report?.layer} · {violation.code.replace(/_/g, " ")}</b>
                      {violation.detail}
                    </li>
                  )),
                )}
                {guardReports.length < 2 ? (
                  <li><b>semantic · report missing</b>Regenerate this change set before review.</li>
                ) : null}
              </ul>
            </section>
          ) : (
            <section className="panel guard-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Claim guard</p>
                  <h2>Every line passed both claim guards</h2>
                </div>
                <span className="status-pill good">passed</span>
              </div>
              <p className="helper-text">
                Deterministic citations, terms, and figures plus semantic polarity, direction, responsibility, and
                proficiency checks passed for content <code>{tailored.guard?.contentHash?.slice(0, 12)}…</code> · generator{" "}
                <code>{tailored.model}</code> · checked {formatTime(tailored.semanticGuard?.checkedAt ?? tailored.generatedAt)}.
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
            <div className="match-matrix">
              {tailored.coverage.map((entry) => (
                <article key={entry.requirementId} className={`match-row ${entry.strength}`}>
                  <div className="match-row-heading">
                    <span className="match-number">JD</span>
                    <span className={`status-pill ${entry.strength === "missing" || entry.strength === "conflict" ? "danger" : entry.strength === "exact" ? "good" : "attention"}`}>
                      {STRENGTH_LABELS[entry.strength]}
                    </span>
                  </div>
                  <div className="match-columns">
                    <div className="requirement-evidence">
                      <div className="match-chips">
                        <span>{entry.priority.replace("_", " ")}</span>
                        <span>{entry.kind}</span>
                      </div>
                    <strong>{entry.text}</strong>
                      {entry.keywords.length > 0 ? (
                        <p className="keyword-row">
                          {entry.keywords.slice(0, 8).map((keyword) => <span key={keyword}>{keyword}</span>)}
                        </p>
                      ) : null}
                      <p className="match-citation">
                        <b>{entry.source.fileName}</b> · {entry.source.locator.replace("line:", "line ")}
                        {entry.source.excerpt ? <q>{entry.source.excerpt}</q> : null}
                      </p>
                    </div>
                    <div className="matched-facts">
                      {entry.facts.length > 0 ? (
                        entry.facts.map((fact) => (
                          <div className="matched-fact" key={fact.factId}>
                            <div className="matched-fact-heading">
                              <strong>{fact.value}</strong>
                              <span>{fact.kind} · {fact.key}</span>
                            </div>
                            {fact.basis ? (
                              <p className="match-basis">
                                {BASIS_LABELS[fact.basis]}{fact.terms.length > 0 ? `: ${fact.terms.join(", ")}` : ""}
                              </p>
                            ) : null}
                            {fact.sources.map((source) => (
                              <p className="match-citation" key={`${source.artifactId}:${source.locator}`}>
                                <b>{source.fileName}</b> · {source.locator.replace("line:", "line ")}
                                {source.excerpt ? <q>{source.excerpt}</q> : null}
                              </p>
                            ))}
                          </div>
                        ))
                      ) : (
                        <div className="no-match">
                          <strong>No verified, conflict-free fact</strong>
                          <p>The gap remains explicit and cannot create resume content.</p>
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="match-rationale">
                    {entry.rationale} · confidence {Math.round(entry.confidence * 100)}%
                  </p>
                </article>
              ))}
            </div>
            {unsupportedCoverage.length > 0 ? (
              <p className="helper-text">
                {unsupportedCoverage.length} requirement(s) are unsupported or disputed. They cannot keep or create
                resume content until trustworthy evidence exists.
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
                      <div className="sentence-review-list">
                        {view.sentences.map((sentenceView) => (
                          <div className="sentence-review" key={sentenceView.sentence.id}>
                            <div className="sentence-copy">
                              {sentenceView.sentence.proposedText ? (
                                <p>
                                  <b>Proposal</b>
                                  {sentenceView.sentence.proposedText}
                                </p>
                              ) : (
                                <p className="sentence-empty"><b>Proposal</b>Remove this sentence</p>
                              )}
                              {sentenceView.sentence.fallbackText ? (
                                <p>
                                  <b>Original</b>
                                  {sentenceView.sentence.fallbackText}
                                </p>
                              ) : null}
                            </div>
                            <div className="sentence-actions">
                              {sentenceView.decision ? (
                                <span className={`status-pill ${sentenceView.decision === "approved" ? "good" : "danger"}`}>
                                  {sentenceView.decision === "approved"
                                    ? sentenceView.sentence.proposedText ? "proposal" : "removed"
                                    : sentenceView.sentence.fallbackText ? "original" : "dropped"}
                                </span>
                              ) : null}
                              <button
                                className="button primary"
                                disabled={busySentenceId === sentenceView.sentence.id || guardFailed || sentenceView.decision === "approved"}
                                onClick={() => void onDecideSentence(view, sentenceView, "approved")}
                              >
                                {sentenceView.sentence.proposedText ? "Use proposal" : "Remove sentence"}
                              </button>
                              <button
                                className="text-button"
                                disabled={busySentenceId === sentenceView.sentence.id || guardFailed || sentenceView.decision === "rejected"}
                                onClick={() => void onDecideSentence(view, sentenceView, "rejected")}
                              >
                                {sentenceView.sentence.fallbackText ? "Keep original" : "Drop sentence"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
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
                    ? `${tailored.pendingChangeIds.length} sentence decision(s) are still unreviewed. A resume version cannot be approved while any sentence is undecided.`
                    : "Every sentence is decided. Approving freezes this content; the document is then built from that approval alone."}
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
              {payload.document?.report?.passed && payload.document.manifestDownloadUrl ? (
                <a className="button secondary" href={payload.document.manifestDownloadUrl} download>
                  Download manifest
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
                    <strong>
                      {payload.document.report?.qualityGates?.filter((gate) => gate.status === "passed").length ?? 0}/5
                    </strong>
                    <span>delivery QA gates</span>
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
                  content <code>{payload.document.build.approvedContentHash.slice(0, 12)}…</code> · template{" "}
                  <code>{payload.document.build.templateVersion ?? payload.document.build.templateId}</code> · every line
                  above cites the verified facts it came from.
                </p>
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}
