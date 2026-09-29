"use client";

import { useState } from "react";
import type { DiscoveryPayload } from "../lib/application-agent";
import type { WebLead } from "../lib/web-job-model";
import styles from "./job-agent.module.css";

export function WebJobSearch({ data, busy, onSearch, onDecide }: {
  data: DiscoveryPayload; busy: boolean;
  onSearch: (query: string) => void;
  onDecide: (lead: WebLead, decision: WebLead["decision"]) => void;
}) {
  const [query, setQuery] = useState('("software engineer" OR "AI engineer" OR "machine learning engineer") jobs (GTA OR Toronto OR Ottawa OR Kingston) Canada');
  const [view, setView] = useState("latest");
  const [visible, setVisible] = useState(20);
  const run = data.webSearch;
  const leads = data.webLeads.filter((lead) => view === "latest" ? run?.leadIds.includes(lead.id) : lead.decision === view);
  return <section className={`panel ${styles.settings}`} aria-label="General web job search">
    <p className="eyebrow">Across job sites</p><h2>Search web jobs</h2>
    <p>Find public search leads from LinkedIn, Indeed, company careers pages and other ATS sites. No Greenhouse / Lever restriction. Coverage depends on the search index.</p>
    <form onSubmit={(event) => { event.preventDefault(); setView("latest"); setVisible(20); onSearch(query); }}>
      <div className={styles.fields}><label>Web job search terms
        <textarea required minLength={3} maxLength={400} rows={3} value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} />
      </label></div>
      <p className={styles.caption}>This query is separate from the board filters above. Edit roles and locations or add site:linkedin.com/jobs/view or site:indeed.com. Send only job-search terms, not personal information. One API request per click, at most 20 results; may use paid search credits.</p>
      <button className="button primary" disabled={busy || !data.sourceSearchProvider.configured}>Search web jobs</button>
    </form>
    {!data.sourceSearchProvider.hasKey ? <p role="status">Requires server-side BRAVE_SEARCH_API_KEY; a Gemini key alone does not enable this search.</p>
      : !data.sourceSearchProvider.storageAllowed ? <p role="status">Confirm your Brave plan permits result storage, then set BRAVE_SEARCH_STORAGE_ALLOWED=true.</p> : null}
    <p className={styles.caption}>Search summaries are unverified, may be stale, and may describe a results page rather than a job. No fit score, posting date or open status is inferred. The agent does not visit these links, log in, upload or apply.</p>
    <nav className={styles.tabs} aria-label="Web lead filters">{["latest", "saved", "dismissed"].map((tab) => <button type="button" key={tab} aria-pressed={view === tab} onClick={() => { setView(tab); setVisible(20); }}>{tab[0]?.toUpperCase()}{tab.slice(1)}</button>)}</nav>
    {run ? <p className={styles.caption}>Last web search: {new Date(run.finishedAt).toLocaleString()} · {run.resultCount} results · {run.skippedCount} unsafe or duplicate links skipped. Query: {run.query}</p> : null}
    {!leads.length ? <p>{view === "latest" && !run ? "Search the web to start a cross-site shortlist." : "No leads in this view. Try another query or source domain."}</p> : null}
    {leads.slice(0, visible).map((lead) => <article key={lead.id} className={styles.sourceSuggestion}>
      <p className="eyebrow">{new URL(lead.url).hostname} · Unverified lead · {lead.decision}</p>
      <h3>{lead.title}</h3><p className={styles.description}>{lead.snippet || "No search summary available."}</p>
      <p className={styles.caption}>Last seen in search {new Date(lead.lastSeenAt).toLocaleDateString()} — not a posting date.</p>
      <div className={styles.actions}>
        <a className="button secondary" href={lead.url} target="_blank" rel="noopener noreferrer">Open source to verify</a>
        <button className="button secondary" disabled={busy || lead.decision === "saved"} onClick={() => onDecide(lead, "saved")}>Save lead</button>
        <button className="text-button" disabled={busy || lead.decision === "dismissed"} onClick={() => onDecide(lead, "dismissed")}>Dismiss lead</button>
        {lead.decision !== "new" ? <button className="text-button" disabled={busy} onClick={() => onDecide(lead, "new")}>Reset to new</button> : null}
      </div>
    </article>)}
    {leads.length > visible ? <button className="button secondary" onClick={() => setVisible((count) => count + 20)}>Show more leads</button> : null}
    <p>Next: verify the employer and current opening yourself, then copy the complete JD into <a href="/jobs">Job intake</a> for requirement review. Saving a lead does not authorize resume preparation or submission.</p>
    <p className={styles.caption}>Saved and dismissed links survive new searches. Older undecided results are replaced. Deduplication is by normalized URL, not by employer or job identity across sites.</p>
  </section>;
}
