"use client";

import { useState } from "react";
import type { DiscoveryPayload } from "../lib/application-agent";
import styles from "./job-agent.module.css";

export function SourceDiscovery({ data, busy, onSearch, onAdd }: {
  data: DiscoveryPayload; busy: boolean;
  onSearch: (query: string) => void;
  onAdd: (searchId: string, suggestionId: string, company: string) => void;
}) {
  const [query, setQuery] = useState('("software engineer" OR "AI engineer" OR "machine learning engineer") (Toronto OR GTA OR Ottawa OR Kingston) Canada');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const run = data.sourceSearch;
  return <section className={`panel ${styles.settings}`} aria-label="Discover company sources">
    <h2>Find more company sources</h2>
    <p>Brave searches the web; the agent verifies supported Greenhouse / Lever feeds. New sources are added only when you choose them. This does not apply to any job.</p>
    <form onSubmit={(event) => { event.preventDefault(); onSearch(query); }}>
      <div className={styles.fields}><label>Search terms (roles and areas, no personal information)
        <textarea rows={3} minLength={3} maxLength={400} required value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} />
      </label></div>
      <p className={styles.caption}>One search request per click; up to 20 results and 6 new feed checks. May consume your search API credits. Current draft preferences are saved before searching; the search terms above are separate and editable.</p>
      <button className="button secondary" disabled={busy || !data.sourceSearchProvider.configured}>Discover sources</button>
    </form>
    {!data.sourceSearchProvider.hasKey ? <p role="status">Requires server-side BRAVE_SEARCH_API_KEY. Gemini uses its own key for matching and resume preparation.</p>
      : !data.sourceSearchProvider.storageAllowed ? <p role="status">Confirm a Brave plan with storage rights and set BRAVE_SEARCH_STORAGE_ALLOWED=true before searching.</p> : null}
    {run ? <div className={styles.task}>
      <p>Last source search: {new Date(run.finishedAt).toLocaleString()} · {run.resultCount} results · {run.skippedCount} duplicates, existing, unsupported or over-limit results skipped.</p>
      <p className={styles.caption}>{run.query}</p>
      <p className={styles.caption}>Match counts reflect all posting preferences at search time, not current qualifications. Feed availability can change; adding expires after 24 hours. Collection rechecks the feed.</p>
      {!run.suggestions.length ? <p>No new supported company feeds found. Try a narrower role or another GTA municipality.</p> : null}
      {run.suggestions.map((suggestion) => {
        const added = data.config.boards.some((s) => s.provider === suggestion.source.provider && s.board.toLowerCase() === suggestion.source.board);
        const key = `${run.id}:${suggestion.id}`;
        return <div key={key} className={styles.sourceSuggestion}>
          <a href={suggestion.url} target="_blank" rel="noreferrer">{suggestion.source.provider}/{suggestion.source.board}</a>
          <p>{suggestion.status === "verified" ? `${suggestion.jobCount} public jobs · ${suggestion.matchingCount} pass search-time posting preferences` : "Feed unavailable"}</p>
          <p className={styles.caption}>{suggestion.message}</p>
          <div className={styles.fields}><label>Company label for {suggestion.source.board}<input value={labels[key] ?? suggestion.source.company} maxLength={200} disabled={busy || added} onChange={(event) => setLabels((current) => ({ ...current, [key]: event.target.value }))} /></label></div>
          <button className="button secondary" disabled={busy || added || suggestion.status !== "verified" || data.config.boards.length >= 12 || !(labels[key] ?? suggestion.source.company).trim()}
            onClick={() => onAdd(run.id, suggestion.id, labels[key] ?? suggestion.source.company)}>{added ? "Source added" : "Add verified source"}</button>
        </div>;
      })}
    </div> : null}
  </section>;
}
