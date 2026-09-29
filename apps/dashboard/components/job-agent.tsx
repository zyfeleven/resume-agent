"use client";

import { useEffect, useState } from "react";
import type { DiscoveryPayload } from "../lib/application-agent";
import { defaultDiscoveryConfig, type Board, type DiscoveryConfig, type DiscoveredJob } from "../lib/discovery-model";
import styles from "./job-agent.module.css";
import { SourceDiscovery } from "./source-discovery";
import { JobFilterFields } from "./job-filter-fields";
import { applicationTaskHref } from "../lib/application-links";

const STATES: Record<string, string> = { queued: "Ready to prepare", preparing: "Preparing resume", needs_review: "Resume ready for review", blocked: "Needs attention", needs_reapproval: "Posting changed", cancelled: "Cancelled" };
const split = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

export function JobAgent() {
  const [data, setData] = useState<DiscoveryPayload | null>(null);
  const [config, setConfig] = useState<DiscoveryConfig>(defaultDiscoveryConfig);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("recommended");
  const [visibleCount, setVisibleCount] = useState(25);
  const [source, setSource] = useState<Board>({ provider: "greenhouse", board: "", company: "" });
  const [roles, setRoles] = useState(defaultDiscoveryConfig.preferences.roles.join(", "));
  const [locations, setLocations] = useState(defaultDiscoveryConfig.preferences.locations.join(", "));
  const [excluded, setExcluded] = useState(defaultDiscoveryConfig.preferences.excludedTitleTerms.join(", "));

  useEffect(() => {
    let active = true;
    void fetch("/api/agent").then(async (response) => {
      if (!response.ok) throw new Error("Could not load the agent. Reload to try again.");
      const payload = await response.json() as DiscoveryPayload;
      if (!active) return;
      setData(payload); setConfig(payload.config);
      setRoles(payload.config.preferences.roles.join(", ")); setLocations(payload.config.preferences.locations.join(", "));
      setExcluded(payload.config.preferences.excludedTitleTerms.join(", "));
    }).catch((error: Error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, []);

  async function request(command: unknown): Promise<DiscoveryPayload> {
    const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "Request failed.");
    setData(payload as DiscoveryPayload);
    return payload as DiscoveryPayload;
  }
  async function act(work: () => Promise<unknown>) {
    setBusy(true); setNotice("");
    try { await work(); } catch (error) { setNotice(error instanceof Error ? error.message : "Request failed."); }
    finally { setBusy(false); }
  }
  async function saveSettings() {
    await request({ action: "configure", config: { ...config, preferences: { ...config.preferences, roles: split(roles), locations: split(locations), excludedTitleTerms: split(excluded) } } });
  }
  async function search() {
    await saveSettings();
    await request({ action: "search" });
  }
  async function decide(job: DiscoveredJob, decision: DiscoveredJob["decision"]) {
    const updated = await request({ action: "decide", id: job.id, fingerprint: job.fingerprint, decision });
    if (decision === "approved") {
      setTab("approved");
      setVisibleCount(25);
      const task = updated.tasks.find((entry) => entry.candidateId === job.id);
      if (task) await request({ action: "prepare", id: task.id });
    }
  }
  const jobs = (data?.jobs ?? []).filter((job) => tab === "all" ? true : tab === "recommended" ? job.rank.eligible && job.decision === "new" : job.decision === tab);
  const lastRun = data?.runs.at(-1);

  return <div className={styles.agent}>
    <section className="workspace-title">
      <div><p className="eyebrow">Your job search</p><h1>Find a role worth applying for.</h1><p>Discover openings, review the shortlist, and prepare a tailored resume for the roles you choose.</p></div>
      <button className="button primary" disabled={busy || !data || config.boards.length === 0} onClick={() => void act(search)}>{busy ? "Working…" : "Save & find jobs"}</button>
    </section>
    {notice ? <p className={styles.notice} role="alert">{notice}</p> : null}
    <section className={`panel ${styles.settings}`}>
      <details open={!data?.config.boards.length}><summary>Search preferences & company sources</summary>
        <div className={styles.fields}>
          <label>Target roles, comma separated<input value={roles} onChange={(event) => setRoles(event.target.value)} disabled={busy} /></label>
          <label>Locations, comma separated<textarea rows={3} value={locations} onChange={(event) => setLocations(event.target.value)} disabled={busy} /></label>
          <label>Exclude title terms<input value={excluded} onChange={(event) => setExcluded(event.target.value)} disabled={busy} /></label>
          <label className={styles.checkbox}><input type="checkbox" checked={config.preferences.includeRemote} disabled={busy} onChange={(event) => setConfig({ ...config, preferences: { ...config.preferences, includeRemote: event.target.checked } })} /> Also include remote roles (eligible countries require review)</label>
        </div>
        <JobFilterFields value={config.preferences.filters} disabled={busy} onChange={(filters) => setConfig((current) => ({ ...current, preferences: { ...current.preferences, filters } }))} />
        <button type="button" className="button secondary" disabled={busy || !data} onClick={() => void act(async () => { await saveSettings(); setNotice("Preferences saved. Existing jobs have been filtered again; no external search was made."); })}>Save preferences</button>
        <h3>Company job boards</h3><p>Search checks the public openings on these boards. Add the company token from its Greenhouse or Lever careers URL, not a full URL.</p>
        <form className={styles.sourceForm} onSubmit={(event) => { event.preventDefault(); setConfig({ ...config, boards: [...config.boards, { ...source, board: source.board.toLowerCase() }] }); setSource({ provider: source.provider, board: "", company: "" }); }}>
          <label>Provider<select value={source.provider} disabled={busy} onChange={(event) => setSource({ ...source, provider: event.target.value as Board["provider"] })}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option></select></label>
          <label>Company<input required maxLength={200} value={source.company} placeholder="Company name" disabled={busy} onChange={(event) => setSource({ ...source, company: event.target.value })} /></label>
          <label>Board token<input required pattern="[a-zA-Z0-9_-]{1,100}" value={source.board} placeholder="company-token" disabled={busy} onChange={(event) => setSource({ ...source, board: event.target.value })} /></label>
          <button className="button secondary" disabled={busy || config.boards.length >= 12}>Add source</button>
        </form>
        <ul>{config.boards.map((board, index) => <li key={`${board.provider}:${board.board}:${index}`}>{board.company} · {board.provider}/{board.board} <button type="button" className="text-button" disabled={busy} onClick={() => setConfig({ ...config, boards: config.boards.filter((_, i) => i !== index) })}>Remove</button></li>)}</ul>
      </details>
    </section>
    {data ? <SourceDiscovery data={data} busy={busy}
      onSearch={(query) => void act(async () => { await saveSettings(); await request({ action: "discover_sources", query }); })}
      onAdd={(searchId, suggestionId, company) => void act(async () => {
        await saveSettings();
        const updated = await request({ action: "add_source", searchId, suggestionId, company });
        setConfig(updated.config);
        setNotice("Source added. Select Save & find jobs to collect its current openings.");
      })} /> : null}
    <section className={styles.summary}>
      <span><strong>{data?.jobs.filter((job) => job.rank.eligible && job.decision === "new").length ?? 0}</strong> recommended</span>
      <span><strong>{data?.tasks.filter((task) => task.state !== "cancelled").length ?? 0}</strong> application tasks</span>
      <span>{data?.intelligence.configured ? "Gemini resume preparation available" : "Add a Gemini key to enable resume preparation"}</span>
    </section>
    <p className={styles.caption}>Ranking currently measures your role and location preferences, not your qualifications. Collection runs when you click Find jobs. Real-site submission is not connected yet.</p>
    {lastRun ? <details className={styles.caption}><summary>Last search: {new Date(lastRun.finishedAt).toLocaleString()}</summary><ul>{lastRun.sources.map((entry) => <li key={`${entry.provider}:${entry.board}`}>{entry.provider}/{entry.board}: {entry.error ?? `${entry.count} jobs checked`}</li>)}</ul></details> : null}
    <nav className={styles.tabs} aria-label="Job filters">{["recommended", "saved", "approved", "dismissed", "all"].map((value) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => { setTab(value); setVisibleCount(25); }}>{value[0]?.toUpperCase()}{value.slice(1)}</button>)}</nav>
    {!data ? <p role="status">Loading your search workspace…</p> : !jobs.length ? <section className={`panel ${styles.empty}`}><h2>{lastRun ? "No roles in this view yet" : "Build your first shortlist"}</h2><p>{lastRun ? "Check source results, adjust preferences, or open All to see every collected role." : "Add company job boards above, then find openings across GTA, Ottawa and Kingston."}</p></section> : null}
    <div className={styles.cards}>{jobs.slice(0, visibleCount).map((job) => {
      const task = data?.tasks.find((entry) => entry.candidateId === job.id);
      const assessment = data?.assessments.find((entry) => entry.candidateId === job.id);
      const leaseActive = task?.state === "preparing" && Date.parse(task.leaseUntil ?? "") > Date.now();
      return <article className={`panel ${styles.card}`} key={job.id}>
        <div className={styles.cardHeading}><div><p className="eyebrow">{job.company} · {job.availability}</p><h2>{job.title}</h2><p>{job.location || "Location not listed"}</p></div><span className={styles.score}>{job.rank.score}<small>Role/location fit</small></span></div>
        <ul>{job.rank.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <details><summary>Posting filter evidence{job.rank.needsReview ? " — needs review" : ""}</summary>
          <p className={styles.caption}>Explicit-text hints only; not a complete semantic or work-authorization assessment. “Match” means this filter passed, not that you qualify for the job.</p>
          {job.rank.constraintChecks.map((check) => <div className={styles.sourceSuggestion} key={check.key}>
            <strong>{check.key === "experience" ? "Required experience" : check.key === "salary" ? "Annual salary" : "Work mode"}: {check.status.replace("_", " ")}</strong>
            <p>{check.reason}</p>
            {check.evidence.map((citation, index) => <p key={index} className={styles.caption}>{citation.source === "location" ? "Source location" : `JD line ${citation.line}`}: <q>{citation.text}</q></p>)}
          </div>)}
        </details>
        <p className={styles.caption}>First seen {new Date(job.firstSeenAt).toLocaleDateString()} · {job.provider} · {job.decision}</p>
        <details><summary>Read job description</summary><p className={styles.description}>{job.description}</p><p className={styles.caption}>{job.rank.caveats.join(" ")}</p></details>
        {assessment ? <section className={styles.task}><strong>{assessment.stale ? "AI assessment needs refreshing" : `AI evidence coverage: ${assessment.score}%`}</strong>
          <p>{assessment.summary}</p><p className={styles.caption}>Gemini assessment of verified facts. Aids your decision; not a hiring probability. {assessment.stale ? "The posting or your profile changed; do not rely on this earlier result." : ""}</p>
          <details><summary>Evidence & gaps</summary><ul>{assessment.requirements.map((r) => <li key={r.id}><strong>{r.support}</strong> · {r.text}<p>{r.reason}</p><small>{r.factIds.length} verified fact reference(s)</small></li>)}</ul><a href="/profile">Review your source facts →</a></details>
        </section> : null}
        {task ? <div className={styles.task} role="status"><strong>{STATES[task.state]}</strong><p>{task.message}</p>
          <a href={applicationTaskHref(task.id)}>Application preparation checklist →</a>
          {task.changeSetId && task.state !== "needs_reapproval" && task.state !== "cancelled" ? <a href={`/resume?changeSetId=${encodeURIComponent(task.changeSetId)}`}>Review this resume →</a> : null}
          {task.jobId ? <a href="/jobs">Review parsed job requirements →</a> : null}
          {(["blocked", "queued", "preparing"].includes(task.state) && !leaseActive) ? <button type="button" className="text-button" disabled={busy} onClick={() => void act(() => request({ action: "prepare", id: task.id }))}>Retry preparation</button> : null}
        </div> : null}
        <div className={styles.actions}>
          <a className="button secondary" href={job.url} target="_blank" rel="noreferrer">View posting</a>
          <button className="button secondary" disabled={busy || job.availability !== "open" || !data?.intelligence.configured} onClick={() => void act(() => request({ action: "assess", id: job.id, fingerprint: job.fingerprint }))}>Assess fit with AI</button>
          <button className="button secondary" disabled={busy} onClick={() => void act(() => decide(job, "saved"))}>Save</button>
          <button className="text-button" disabled={busy} onClick={() => void act(() => decide(job, "dismissed"))}>Dismiss</button>
          <button className="button primary" disabled={busy || job.availability !== "open" || job.decision === "approved"} onClick={() => void act(() => decide(job, "approved"))}>Approve & prepare</button>
        </div>
      </article>;
    })}</div>
    {jobs.length > visibleCount ? <button type="button" className="button secondary" onClick={() => setVisibleCount((count) => count + 25)}>Show more ({jobs.length - visibleCount} remaining)</button> : null}
  </div>;
}
